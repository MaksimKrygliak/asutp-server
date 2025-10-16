import mongoose from "mongoose";

const PostSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      unique: true, 
      sparse: true,
    },
    title: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    pech: {
      type: String,
      default: null,
    },
    tags: {
      type: Array,
      default: [],
    },
    type: {
      type: String,
      enum: ["інформаційна", "аварійна"],
      default: "інформаційна",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    viewedByUsers: {
      type: Array,
      default: [],
    },
    resolved: {
      type: Boolean,
      default: null,
    },
    isDeleted: { type: Boolean, default: false }, // Флаг мягкого удаления
    deletedAt: { type: Date, default: null }, // Время мягкого удаления
    
    imageUrl: String,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Post", PostSchema);
