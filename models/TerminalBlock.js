import mongoose from "mongoose";

const TerminalBlockSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    position: { type: Number, required: true, default: 0 },
    enclosurePosition: { type: Number, default: 0 },
    enclosureItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EnclosureItem",
      required: true,
    },

    isPendingDeletion: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

TerminalBlockSchema.virtual("signals", {
  ref: "Signal",
  localField: "_id",
  foreignField: "terminalBlock",
  options: { sort: { address: 1 } }, // Авто-сортировка по адресу сигнала
});

TerminalBlockSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Для синхронизации
TerminalBlockSchema.index({ enclosureItem: 1 });

export default mongoose.model("TerminalBlock", TerminalBlockSchema);
