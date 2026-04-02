This is a very smart strategy. Starting with a **5-class pilot (A, B, C, D, E)** allows you to verify that the new **126-dimensional logic** and **Mirroring Augmentation** actually work before you spend hours training the full 28-class set.

Here is your step-by-step guide to executing this pilot run:

### Step 1: Prepare the "Unprocessed" Folders
Ensure your raw video data is organized specifically for this test.
1.  Navigate to your `unprocessed_input/training_data/` folder.
2.  Temporarily move all folders except **A, B, C, D, and E** to a backup location outside the project.
3.  Do the same for `validation_data` and `testing_data`.
4.  **Result:** You should only see 5 subfolders in each split.

### Step 2: Extract the "Phrase-Ready" Data
You must re-run the extraction because the model now expects 126 dimensions (two hands) instead of 63.
1.  Delete your current `processed_output/frame_extracted` folder (to ensure no old 63-dim data remains).
2.  Run your updated **`frame_extractor.py`**.
3.  **Verification:** After it finishes, check one clip folder. Open `landmarks.npy` in a python shell:
    ```python
    import numpy as np
    data = np.load('path/to/landmarks.npy')
    print(data.shape) # MUST BE (32, 126)
    ```

### Step 3: Configure `train.py` for the Pilot
Update the constants at the top of your **`train.py`**:
```python
# Updated for Pilot Run
CLASS_NAMES = ["A", "B", "C", "D", "E"]
NUM_CLASSES = 5 

# Since it's only 5 classes, we can increase the batch size for stability
BATCH_SIZE = 16 
EPOCHS = 30
FREEZE_EPOCHS = 5 # Unfreeze earlier since the dataset is small
```

### Step 4: Run Training & Monitor the "Curve"
Start the training. Watch the logs for these three things:
1.  **Initial Loss:** Should start high but drop quickly in the first 5 epochs (Geometric learning).
2.  **The "C" Check:** Look at the training accuracy. Is it stuck at 20%? (20% is $1/5$ classes). If it is stuck at 20%, it is still "guessing" only one letter. If it climbs to 40%–60% by Epoch 10, the bias is fixed!
3.  **Unfreeze Jump:** At Epoch 6 (when ResNet unfreezes), you should see a small "dip" in accuracy followed by a strong climb as it starts using visual textures.

### Step 5: Local Validation (The Confusion Matrix)
Before going to Modal, run a quick evaluation script to see the **Confusion Matrix**.
*   **Success looks like:** A diagonal line of high numbers.
*   **Failure looks like:** A vertical column under "C". (If this happens, we need to lower the `class_weight` for C even further).

### Step 6: Deploy to Modal
Once you are happy with the local test results:
1.  **Upload the weights:**
    ```bash
    modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /model/juansign_model.pth
    ```
2.  **Deploy the endpoint:**
    ```bash
    modal deploy ml-model/main.py
    ```
3.  **Test via Frontend:** Record a 'D' or 'E' and see if the Modal endpoint returns the correct prediction.

### Why this is the right move:
If the model can't distinguish between **A and E** (which look very different), it definitely won't be able to handle **M, N, and T** (which look almost identical). Solving the problem here with 5 classes saves you days of frustration later.

**Are you ready to start the extraction for A-E?**