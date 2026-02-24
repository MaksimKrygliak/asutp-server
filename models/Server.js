import mongoose from "mongoose";

const ServerSchema = new mongoose.Schema(
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
    login: { type: String },
    password: { type: String },
    IPaddress: { type: String },
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

ServerSchema.virtual("virtualMachines", {
  ref: "VirtualMachine",
  localField: "_id", 
  foreignField: "server",
  options: { sort: { position: 1 } },
});

ServerSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Для синхронизации
ServerSchema.index({ premise: 1 }); // Поиск серверов в помещении
ServerSchema.index({ ups: 1 });

export default mongoose.model("Server", ServerSchema);
