import torch
import os
from PIL import Image
from torchvision import transforms
from resnet_lstm_architecture import ResNetLSTM

def predict_folder(model_path, clip_path, class_names):
    # 1. Setup Device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # 2. Initialize and Load Model
    num_classes = len(class_names)
    model = ResNetLSTM(num_classes=num_classes).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    # 3. Define the same transforms used in training
    # We don't use RandomRotation here because we want an honest prediction
    inference_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    # 4. Load and Process 16 Frames
    frames = []
    # Get first 16 jpg files in the folder
    all_frames = sorted([f for f in os.listdir(clip_path) if f.endswith('.jpg')])[:16]
    
    if len(all_frames) < 16:
        return f"Error: Only found {len(all_frames)} frames. Need 16."

    for frame_name in all_frames:
        img_path = os.path.join(clip_path, frame_name)
        img = Image.open(img_path).convert('RGB')
        img = inference_transform(img)
        frames.append(img)

    # Stack frames and add Batch dimension [1, 16, 3, 224, 224]
    input_tensor = torch.stack(frames).unsqueeze(0).to(device)

    # 5. Predict
    with torch.no_grad():
        output = model(input_tensor)
        # Get probabilities
        probabilities = torch.nn.functional.softmax(output, dim=1)
        confidence, predicted = torch.max(probabilities, 1)

    predicted_class = class_names[predicted.item()]
    confidence_score = confidence.item() * 100

    return predicted_class, confidence_score

if __name__ == "__main__":
    # CONFIGURATION
    MODEL_FILE = "./juansignmodel/juansign_model.pth"
    # Provide a path to a clip folder in your test set
    TEST_CLIP = "./processed_output/model_check/test_data/H" 
    # Must match the order of your folders
    MY_CLASSES = ["A", "B", "C", "G", "H"] 

    result, score = predict_folder(MODEL_FILE, TEST_CLIP, MY_CLASSES)
    
    print("-" * 30)
    print(f"CLIP PATH: {TEST_CLIP}")
    print(f"AI PREDICTION: {result}")
    print(f"CONFIDENCE: {score:.2f}%")
    print("-" * 30)