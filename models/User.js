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
    passwordHash: {
      type: String,
      required: true,
    },
    avatarUrl: String,
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationToken: String,
    role: {
      type: String,
      enum: ["звичайний", "адміністратор"],
      default: "звичайний",
    },
    viewedPosts: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [], // Встановлюємо порожній масив за замовчуванням
      ref: 'Post', // Посилання на модель Post (якщо потрібно)
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", UserSchema);
