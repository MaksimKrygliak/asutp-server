import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    engineerPosition: {
      type: String,
      required: true,
    },
    brigade: {
      type: Number,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    avatarUrl: {
      type: String,
      default: "",
    },
    cloudinaryPublicId: {
      type: String,
      default: "",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["адміністратор", "1", "2", "3"], // Заменил числа на строки, чтобы соответствовать вашей Realm-схеме
      default: "1", // По умолчанию тоже строка
    },
    permissions: [{ type: String, default: [] }],
    viewedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
      },
    ],
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date,

    // --- Добавляем объект для меток синхронизации ---
    lastSyncTimes: {
      type: new mongoose.Schema(
        {
          documents: { type: Date, default: null }, // Время последней синхронизации документов
          notes: { type: Date, default: null }, // Время последней синхронизации заметок
          users: { type: Date, default: null }, // Время последней синхронизации данных пользователей
          // Добавьте здесь другие типы данных, которые вы хотите синхронизировать
        },
        { _id: false } // Важно: отключаем создание _id для вложенного объекта
      ),
      default: {}, // Инициализируем по умолчанию пустым объектом, если не указано
    },
  },
  {
    timestamps: true, // `createdAt` и `updatedAt` будут добавляться автоматически
  }
);

export default mongoose.model("User", UserSchema);
