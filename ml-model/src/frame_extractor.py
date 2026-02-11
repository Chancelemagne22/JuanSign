import os
import cv2
import numpy as np

def scaled_down_direct(frame, output_path):
    """Resize frame directly to 224x224 and save"""
    try:
        data = cv2.resize(frame, (224, 224), interpolation=cv2.INTER_AREA)
        cv2.imwrite(output_path, data)
        return True
    except Exception as e:
        print(f"  ❌ Error resizing: {e}")
        return False


def extract_and_resize_frames(video_path, output_folder):
    """
    Extract frames from video and resize directly to 224x224
    """
    cam = cv2.VideoCapture(video_path)
    
    if not cam.isOpened():
        print(f"  ❌ Cannot open video: {video_path}")
        return
    
    totalFrame = int(cam.get(cv2.CAP_PROP_FRAME_COUNT))
    skip = max(1, totalFrame // 16)  # Extract 16 frames
    
    currentframe = 0
    frame_counter = 0
    
    print(f"  🎬 Extracting and resizing frames...")
    
    while True:
        ret, frame = cam.read()
        
        if not ret:
            break
        
        if frame_counter % skip == 0:
            # Resize and save directly
            frame_path = os.path.join(output_folder, f"frame{str(currentframe).zfill(4)}.jpg")
            scaled_down_direct(frame, frame_path)
            currentframe += 1
        
        frame_counter += 1
    
    cam.release()
    print(f"  ✅ Extracted and resized {currentframe} frames to 128x128")


def process_file(file_path, output_folder):
    """Process video file"""
    if file_path.endswith(('.mp4', '.avi', '.MOV', '.mkv')):
        extract_and_resize_frames(file_path, output_folder)
    else:
        print(f"  ⚠️  Skipping non-video file: {file_path}")


def recreate_folder_structure_with_file_folders(root_folder, output_folder):
    """Recreate folder structure"""
    
    for letter_folder in os.listdir(root_folder):
        letter_path = os.path.join(root_folder, letter_folder)
        
        if not os.path.isdir(letter_path):
            continue
        
        print(f"\n📁 Processing folder: {letter_folder}")

        
        output_letter_path = os.path.join("..",output_folder, letter_folder)
        os.makedirs(output_letter_path, exist_ok=True)
        
        clip_counter = 1
        for filename in os.listdir(letter_path):
            file_path = os.path.join(letter_path, filename)
            
            if os.path.isdir(file_path):
                continue
            

            file_name_without_ext = os.path.splitext(filename)[0]
            file_output_folder = os.path.join(output_letter_path, file_name_without_ext)
            new_output_name = os.path.join(output_letter_path, f"clip{str(clip_counter).zfill(3)}" )

            os.makedirs(file_output_folder, exist_ok=True)
            
            print(f"  📄 File: {filename}")
            print(f"  ✅ Output: {file_output_folder}")
            
            process_file(file_path, file_output_folder)
            os.rename(file_output_folder, new_output_name)
            print(new_output_name)

            clip_counter += 1


# RUN
if __name__ == "__main__":
    recreate_folder_structure_with_file_folders("../unprocessed_input", "processed_output")
    print("\n✅ ALL DONE!")