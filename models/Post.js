import mongoose from "mongoose";

const PostSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      unique: true,
      required: true,
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
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Section",
      default: null,
    },
    premise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Premise",
      default: null,
    },
    enclosure: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnclosureItem",
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    type: {
      type: String,
      enum: ["інформаційна", "аварійна"],
      default: "інформаційна",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    viewedByUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    resolved: {
      type: Boolean,
      default: null,
    },
    isPendingDeletion: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    imageUrl: String,
  },
  {
    timestamps: true,
  }
);

PostSchema.index({ isPendingDeletion: 1, updatedAt: -1 });
PostSchema.index({ enclosure: 1 });
PostSchema.index({ premise: 1 });
PostSchema.index({ location: 1 });
PostSchema.index({ user: 1 });

export default mongoose.model("Post", PostSchema);
