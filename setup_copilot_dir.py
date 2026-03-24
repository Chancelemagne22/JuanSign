import os
import shutil

# Create .github directory in the Thesis folder
repo_root = r"C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis"
github_dir = os.path.join(repo_root, ".github")

# Create the directory
os.makedirs(github_dir, exist_ok=True)

# Copy the copilot-instructions.md from .claude to .github
src_file = os.path.join(repo_root, ".claude", "copilot-instructions.md")
dst_file = os.path.join(github_dir, "copilot-instructions.md")

if os.path.exists(src_file):
    shutil.copy2(src_file, dst_file)
    print(f"Successfully copied to {dst_file}")
else:
    print(f"Source file not found: {src_file}")

print(f".github directory exists: {os.path.exists(github_dir)}")
