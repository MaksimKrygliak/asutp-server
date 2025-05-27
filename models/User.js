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
    role: {
      type: String,
      enum: ["адміністратор", 1, 2, 3],
      default: 1,
    },
    viewedPosts: [{
      type: String, // <-- ИЗМЕНИТЕ ЭТО С ObjectId НА String
      trim: true // Опционально: убирает пробелы
    }],
    verificationToken: String,
    resetPasswordToken: String, // Токен для сброса пароля
    resetPasswordExpires: Date,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", UserSchema);
