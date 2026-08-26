import cv2
import json
import argparse
import sys
import os
from anime_face_detector import create_detector

def main():
    parser = argparse.ArgumentParser(description="Extract faces from video at given timestamps.")
    parser.add_argument("--video", required=True, help="Path to video file")
    parser.add_argument("--timestamps", required=True, help="Path to JSON file with array of seconds [1.5, 3.0, ...]")
    parser.add_argument("--output_dir", required=True, help="Directory to save cropped faces")
    
    args = parser.parse_args()

    if not os.path.exists(args.output_dir):
        os.makedirs(args.output_dir, exist_ok=True)

    with open(args.timestamps, 'r', encoding='utf-8') as f:
        timestamps = json.load(f)

    # Initialize YOLOv3 based anime face detector
    # This downloads the pretrained model automatically on first run
    detector = create_detector('yolov3')

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)

    results = {}

    for i, t_sec in enumerate(timestamps):
        frame_idx = int(t_sec * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue
            
        # Detect faces
        preds = detector(frame)
        
        # preds is a list of detected faces. 
        # Each face has 'bbox' (x_min, y_min, x_max, y_max, score) and 'keypoints'
        if len(preds) > 0:
            # Sort by score or bounding box size to get the main face
            preds.sort(key=lambda x: x['bbox'][4], reverse=True)
            best_face = preds[0]
            bbox = best_face['bbox']
            
            x_min, y_min, x_max, y_max, score = map(int, bbox[:5])
            
            # Add padding
            h, w = frame.shape[:2]
            pad = 20
            x_min = max(0, x_min - pad)
            y_min = max(0, y_min - pad)
            x_max = min(w, x_max + pad)
            y_max = min(h, y_max + pad)
            
            face_crop = frame[y_min:y_max, x_min:x_max]
            
            out_path = os.path.join(args.output_dir, f"face_{i}.jpg")
            cv2.imwrite(out_path, face_crop)
            
            results[str(t_sec)] = {
                "face_path": out_path,
                "score": float(bbox[4])
            }

    cap.release()

    # Output JSON result
    print(json.dumps(results, ensure_ascii=False))

if __name__ == "__main__":
    main()
