import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    microsoftId: {
      type: String,
      required: true,
    },
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
    avatarUrl: {
      type: String,
      default: "",
    },
    cloudinaryPublicId: {
      type: String,
      default: "",
    },
    fcmToken: {
      type: String,
      optional: true,
    },
    appVersion: {
      type: String,
      default: "",
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
  },
  {
    timestamps: true, // `createdAt` и `updatedAt` будут добавляться автоматически
  }
);

export default mongoose.model("User", UserSchema);
