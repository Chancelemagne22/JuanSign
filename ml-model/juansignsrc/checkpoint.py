import torch

ckpt = torch.load(
    "./juansignmodel/juansign_model.pth",
    map_location="cpu",
    weights_only=False
)
print(ckpt.keys())
print(f"Epoch saved     : {ckpt['epoch']}")
print(f"Val Acc         : {ckpt['val_acc']:.4f}")
print(f"Val Loss        : {ckpt['val_loss']:.4f}")
print(f"Num classes     : {ckpt['num_classes']}")
print(f"Class names     : {ckpt['class_names']}")
print(f"Model keys      : {list(ckpt['model_state'].keys())[:5]} ...")