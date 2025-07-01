import mongoose from "mongoose";

const PostSchema = new mongoose.Schema(
  {
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
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      unique: true, // Должен быть уникальным для каждого поста (клиентский UUID)
      sparse: true, // Позволяет документам не иметь этого поля, если оно не нужно
    },
    imageUrl: String,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Post", PostSchema);
