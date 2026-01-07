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

    // Поля для шифрування
    login: { type: String },
    password: { type: String },

    IPaddress: { type: String },

    // Батько: Приміщення
    premise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Premise",
      required: true,
    },

    // 🔥 Це реальний масив IDs. Віртуальне поле знизу ми видалили.
    virtualMachines: [
      { type: mongoose.Schema.Types.ObjectId, ref: "VirtualMachine" },
    ],

    isPendingDeletion: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

export default mongoose.model("Server", ServerSchema);
