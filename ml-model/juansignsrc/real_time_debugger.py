import cv2
import torch
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from collections import deque
from resnet_lstm_architecture import ResNetLSTM

# --- CONFIG ---
MODEL_PATH = "./juansignmodel/juansign_model_v2_2.pth"
HAND_MODEL_PATH = "./hand_landmarker.task" # Ensure this file is in your folder
FACE_MODEL_PATH = "./blaze_face_short_range.tflite"

TARGET_SIZE = 224
TARGET_FRAMES = 32
LANDMARK_FEATURE = 126
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# ══════════════════════════════════════════════════════════════════════════════
# MEDIAPIPE TASKS SETUP (Replaces mp.solutions)
# ══════════════════════════════════════════════════════════════════════════════

def build_detectors():
    # Hand Detector
    hand_base = mp_python.BaseOptions(model_asset_path=HAND_MODEL_PATH)
    hand_opts = mp_vision.HandLandmarkerOptions(
        base_options=hand_base,
        num_hands=2,
        min_hand_detection_confidence=0.5
    )
    # Face Detector (for anchor)
    face_base = mp_python.BaseOptions(model_asset_path=FACE_MODEL_PATH)
    face_opts = mp_vision.FaceDetectorOptions(base_options=face_base)
    
    return (mp_vision.HandLandmarker.create_from_options(hand_opts),
            mp_vision.FaceDetector.create_from_options(face_opts))

def get_relative_lms(hand_result, face_center):
    """V2.2 Math: Subtract wrist and handle 2 hands"""
    lm_tensor = torch.zeros(126)
    
    if hand_result.hand_landmarks:
        for i, hand in enumerate(hand_result.hand_landmarks):
            if i >= 2: break 
            offset = i * 63
            # Wrist is index 0 in MediaPipe
            wrist = hand[0]
            for j, pt in enumerate(hand):
                lm_tensor[offset + j*3] = pt.x - wrist.x
                lm_tensor[offset + j*3 + 1] = pt.y - wrist.y
                lm_tensor[offset + j*3 + 2] = pt.z - wrist.z
            
    # If a hand is missing, relative coordinates stay 0 (since it's relative to wrist)
    return lm_tensor

# ══════════════════════════════════════════════════════════════════════════════
# MAIN VISUALIZER
# ══════════════════════════════════════════════════════════════════════════════

def visualize():
    # 1. Load Model
    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE)
    class_names = checkpoint["class_names"]
    model = ResNetLSTM(num_classes=len(class_names)).to(DEVICE)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    # 2. Build Detectors
    hand_detector, face_detector = build_detectors()

    # 3. Temporal Buffers
    frame_buffer = deque(maxlen=TARGET_FRAMES)
    lm_buffer = deque(maxlen=TARGET_FRAMES)
    
    cap = cv2.VideoCapture(0)

    print(f"Debugger active. Press 'q' to quit.")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        frame = cv2.flip(frame, 1)
        h, w, _ = frame.shape
        display_frame = frame.copy()

        # Wrap frame for MediaPipe
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

        # 4. Detect Face (for anchor)
        face_res = face_detector.detect(mp_image)
        face_center = [0.5, 0.5, 0.0]
        if face_res.detections:
            bb = face_res.detections[0].bounding_box
            face_center = [(bb.origin_x + bb.width/2)/w, (bb.origin_y + bb.height/2)/h, 0.0]

        # 5. Detect Hands & Crop
        hand_res = hand_detector.detect(mp_image)
        
        crop_rgb = np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8)
        current_lms = torch.zeros(126)

        if hand_res.hand_landmarks:
            current_lms = get_relative_lms(hand_res, face_center)

            # Draw simple dots for feedback
            for hand in hand_res.hand_landmarks:
                for lm in hand:
                    cv2.circle(display_frame, (int(lm.x*w), int(lm.y*h)), 2, (0, 255, 0), -1)

            # Calculate Bounding Box for ALL hands
            all_x = [lm.x * w for hand in hand_res.hand_landmarks for lm in hand]
            all_y = [lm.y * h for hand in hand_res.hand_landmarks for lm in hand]
            x1, y1 = int(min(all_x)-40), int(min(all_y)-40)
            x2, y2 = int(max(all_x)+40), int(max(all_y)+40)
            
            crop = frame[max(0,y1):min(h,y2), max(0,x1):min(w,x2)]
            if crop.size > 0:
                crop_rgb = cv2.resize(crop, (TARGET_SIZE, TARGET_SIZE))

        # 6. Preprocess for ResNet50
        rgb_tensor = cv2.cvtColor(crop_rgb, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb_tensor = (rgb_tensor - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
        rgb_tensor = torch.from_numpy(rgb_tensor).permute(2, 0, 1)
        
        input_frame = torch.cat([rgb_tensor, torch.zeros(2, 224, 224)], dim=0) # 5-ch

        frame_buffer.append(input_frame)
        lm_buffer.append(current_lms)

        # 7. Prediction
        pred_text = "Buffering..."
        if len(frame_buffer) == TARGET_FRAMES:
            f_batch = torch.stack(list(frame_buffer)).unsqueeze(0).to(DEVICE)
            l_batch = torch.stack(list(lm_buffer)).unsqueeze(0).to(DEVICE)
            
            with torch.no_grad():
                logits = model(f_batch, l_batch)
                probs = torch.softmax(logits, dim=1)
                conf, idx = torch.max(probs, dim=1)
                pred_text = f"{class_names[idx.item()]} ({conf.item()*100:.1f}%)"

        # 8. Layout
        cv2.putText(display_frame, f"PRED: {pred_text}", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 3)
        debug_window = np.hstack((cv2.resize(display_frame, (640, 480)), cv2.resize(crop_rgb, (480, 480))))
        cv2.imshow("JuanSign V2.2 Debugger", debug_window)

        if cv2.waitKey(1) & 0xFF == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    visualize()