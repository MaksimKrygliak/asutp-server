import mongoose from "mongoose";

const EnclosureItemSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    title: { type: String, required: true },
    image: { type: String },
    position: { type: Number, required: true, default: 0 },
    description: { type: String },
    premise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Premise",
      required: true,
    },
    ups: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ups",
      default: null,
    },
    isPendingDeletion: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

EnclosureItemSchema.virtual("terminalBlocks", {
  ref: "TerminalBlock",
  localField: "_id",
  foreignField: "enclosureItem",
  options: { sort: { position: 1 } },
});

EnclosureItemSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Для синхронизации
EnclosureItemSchema.index({ premise: 1 }); // Поиск шкафов в помещении
EnclosureItemSchema.index({ ups: 1 });

export default mongoose.model("EnclosureItem", EnclosureItemSchema);
