import mongoose from "mongoose";

const SectionSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    image: { type: String },
    position: { type: Number, required: true, default: 0 },
    isPendingDeletion: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

SectionSchema.virtual("premises", {
  ref: "Premise",
  localField: "_id",
  foreignField: "section",
  options: { sort: { position: 1 } },
});

SectionSchema.index({ isPendingDeletion: 1, updatedAt: -1 });

export default mongoose.model("Section", SectionSchema);
