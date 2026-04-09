// utils/cloudinaryHelper.js
import { v2 as cloudinary } from "cloudinary";

export const deleteOldCloudinaryImage = async (publicId) => {
  // Если ID пустой, или это локальный путь (ошибка синхронизации), или веб-ссылка - игнорируем
  if (!publicId || publicId.startsWith("file://") || publicId.startsWith("http")) {
    return;
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`🗑️ Видалено стару картинку з Cloudinary: ${publicId} (Результат: ${result.result})`);
  } catch (error) {
    console.error(`❌ Помилка видалення з Cloudinary (${publicId}):`, error);
  }
};