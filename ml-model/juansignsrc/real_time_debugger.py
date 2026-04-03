# ml-model/src/realtime_debug_v2_2.py
import cv2
import torch
import numpy as np
import mediapipe as mp
from collections import deque
from resnet_lstm_architecture import ResNetLSTM

# --- CONFIG ---
MODEL_PATH = "./juansignmodel/juansign_model_v2_2.pth" # Path to your 98% model
TARGET_SIZE = 224
TARGET_FRAMES = 32
LANDMARK_FEATURE = 126
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# --- MEDIAPIPE ---
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=2, min_detection_confidence=0.5)
mp_face = mp.solutions.face_detection
face_det = mp_face.FaceDetection(model_selection=0, min_detection_confidence=0.5)
mp_drawing = mp.solutions.drawing_utils

def get_relative_lms(lm_list, face_center):
    """V2.2 Math: Subtract wrist and handle 2 hands"""
    lm_tensor = torch.zeros(126)
    # MediaPipe returns hands in order of detection
    for i, hand in enumerate(lm_list):
        if i >= 2: break 
        offset = i * 63
        # Wrist is index 0
        wrist_x, wrist_y, wrist_z = hand[0].x, hand[0].y, hand[0].z
        for j, pt in enumerate(hand):
            lm_tensor[offset + j*3] = pt.x - wrist_x
            lm_tensor[offset + j*3 + 1] = pt.y - wrist_y
            lm_tensor[offset + j*3 + 2] = pt.z - wrist_z
            
    # Fill missing hands with Face Center (Relative to wrist which is 0, so just 0)
    if len(lm_list) < 2:
        for i in range(len(lm_list), 2):
            offset = i * 63
            lm_tensor[offset:offset+63] = 0 # If hand missing, set relative to 0
    return lm_tensor

def visualize():
    # 1. Load Model
    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE)
    class_names = checkpoint["class_names"]
    model = ResNetLSTM(num_classes=len(class_names)).to(DEVICE)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    # 2. Temporal Buffers
    frame_buffer = deque(maxlen=TARGET_FRAMES)
    lm_buffer = deque(maxlen=TARGET_FRAMES)
    
    cap = cv2.VideoCapture(0)

    print(f"Debugger active. Model: {len(class_names)} classes. Press 'q' to quit.")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        frame = cv2.flip(frame, 1)
        h, w, _ = frame.shape
        display_frame = frame.copy()

        # 3. Detect Face (for anchor)
        face_results = face_det.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        face_center = [0.5, 0.5, 0.0]
        if face_results.detections:
            bbox = face_results.detections[0].location_data.relative_bounding_box
            face_center = [bbox.xmin + bbox.width/2, bbox.ymin + bbox.height/2, 0.0]

        # 4. Detect Hands & Crop
        hand_results = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        
        crop_rgb = np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8)
        current_lms = torch.zeros(126)

        if hand_results.multi_hand_landmarks:
            # Draw skeleton for you to see
            for res in hand_results.multi_hand_landmarks:
                mp_drawing.draw_landmarks(display_frame, res, mp_hands.HAND_CONNECTIONS)
            
            # Apply Relative Normalization
            current_lms = get_relative_lms(hand_results.multi_hand_landmarks, face_center)

            # Calculate Bounding Box for ALL hands
            all_x = [lm.x * w for res in hand_results.multi_hand_landmarks for lm in res.landmark]
            all_y = [lm.y * h for res in hand_results.multi_hand_landmarks for lm in res.landmark]
            x1, y1 = int(min(all_x)-40), int(min(all_y)-40)
            x2, y2 = int(max(all_x)+40), int(max(all_y)+40)
            
            crop = frame[max(0,y1):min(h,y2), max(0,x1):min(w,x2)]
            if crop.size > 0:
                crop_rgb = cv2.resize(crop, (TARGET_SIZE, TARGET_SIZE))

        # 5. Preprocess for ResNet50
        rgb_tensor = cv2.cvtColor(crop_rgb, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb_tensor = (rgb_tensor - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
        rgb_tensor = torch.from_numpy(rgb_tensor).permute(2, 0, 1) # [3, 224, 224]
        
        # Add a dummy optical flow (zeros) for real-time preview (or calc it if needed)
        flow_dummy = torch.zeros(2, 224, 224)
        input_frame = torch.cat([rgb_tensor, flow_dummy], dim=0) # [5, 224, 224]

        frame_buffer.append(input_frame)
        lm_buffer.append(current_lms)

        # 6. Prediction
        pred_text = "Buffering..."
        if len(frame_buffer) == TARGET_FRAMES:
            f_batch = torch.stack(list(frame_buffer)).unsqueeze(0).to(DEVICE)
            l_batch = torch.stack(list(lm_buffer)).unsqueeze(0).to(DEVICE)
            
            with torch.no_grad():
                logits = model(f_batch, l_batch)
                probs = torch.softmax(logits, dim=1)
                conf, idx = torch.max(probs, dim=1)
                
                if conf.item() > 0.70:
                    pred_text = f"{class_names[idx.item()]} ({conf.item()*100:.1f}%)"
                else:
                    pred_text = "Thinking..."

        # 7. Layout
        # Top: Live Camera | Right: Model Input (Zoomed)
        cv2.putText(display_frame, f"PREDICTION: {pred_text}", (10, 50), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 3)
        
        debug_window = np.hstack((cv2.resize(display_frame, (640, 480)), 
                                  cv2.resize(crop_rgb, (480, 480))))
        
        cv2.imshow("JuanSign V2.2 Real-Time Debugger", debug_window)

        if cv2.waitKey(1) & 0xFF == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    visualize()