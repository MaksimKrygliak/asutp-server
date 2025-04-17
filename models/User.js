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
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", UserSchema);
