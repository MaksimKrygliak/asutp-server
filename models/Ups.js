import mongoose from "mongoose";

const UpsSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    image: {
      type: String,
    },
    IPaddress: {
      type: String,
      default: "",
    },
    login: { type: String },
    password: { type: String },
    position: { type: Number, required: true, default: 0 },
    premise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Premise",
      required: true,
    },
    isPendingDeletion: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals
UpsSchema.virtual("poweredServers", {
  ref: "Server",
  localField: "_id",
  foreignField: "ups",
});

UpsSchema.virtual("poweredComputers", {
  ref: "Computer",
  localField: "_id",
  foreignField: "ups",
});

UpsSchema.virtual("poweredCabinets", {
  ref: "EnclosureItem",
  localField: "_id",
  foreignField: "ups",
});

UpsSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Для синхронизации
UpsSchema.index({ premise: 1 });

export default mongoose.model("Ups", UpsSchema);
