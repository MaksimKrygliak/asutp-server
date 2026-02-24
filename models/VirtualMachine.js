import mongoose from "mongoose";

const VirtualMachineSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    image: { type: String },
    login: { type: String },
    password: { type: String },
    IPaddress: { type: String, default: "" },
    position: { type: Number, default: 0 },
    server: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: false,
    },
    computer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Computer",
      required: false,
    },
    isPendingDeletion: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

VirtualMachineSchema.pre("save", function (next) {
  if (!this.server && !this.computer && !this.isPendingDeletion) {
    next(
      new Error("VirtualMachine must belong to either a Server or a Computer")
    );
  } else {
    next();
  }
});

VirtualMachineSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Для синхронизации
VirtualMachineSchema.index({ server: 1 });   // Поиск ВМ на сервере
VirtualMachineSchema.index({ computer: 1 });

export default mongoose.model("VirtualMachine", VirtualMachineSchema);
