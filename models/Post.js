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
      unique: true,
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
    viewsCount: {
      type: Number,
      default: 0,
    },
    resolved: {
      type: Boolean,
    },
    comments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Comment",
      },
    ],
    imageUrl: String,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Post", PostSchema);
