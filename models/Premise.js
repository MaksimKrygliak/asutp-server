import mongoose from "mongoose";

const PremiseSchema = new mongoose.Schema(
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
    section: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Section",
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

PremiseSchema.virtual("servers", {
  ref: "Server",
  localField: "_id",
  foreignField: "premise",
  options: { sort: { position: 1 } },
});

PremiseSchema.virtual("computers", {
  ref: "Computer",
  localField: "_id",
  foreignField: "premise",
  options: { sort: { position: 1 } },
});

PremiseSchema.virtual("enclosureItems", {
  ref: "EnclosureItem",
  localField: "_id",
  foreignField: "premise",
  options: { sort: { position: 1 } },
});

PremiseSchema.virtual("ups", {
  ref: "Ups",
  localField: "_id",
  foreignField: "premise",
  options: { sort: { position: 1 } },
});

PremiseSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Для синхронизации
PremiseSchema.index({ section: 1 });

export default mongoose.model("Premise", PremiseSchema);
