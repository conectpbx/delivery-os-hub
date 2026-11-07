/** Reduce mobile upload size before base64 encoding. Images stay local until the user requests OCR. */
export async function prepareScanImage(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Envie uma imagem JPG, PNG ou WebP.");
  if (file.size > 6_000_000) throw new Error("A imagem deve ter no máximo 6 MB.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar esta imagem.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    image.close();
  }
}
