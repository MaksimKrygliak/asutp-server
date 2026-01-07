import mongoose from "mongoose";

const VirtualMachineSchema = new mongoose.Schema(
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

    // УБРАЛИ required: true
    // Ссылка на компьютер (может быть null, если ВМ на сервере)
    computer: { type: mongoose.Schema.Types.ObjectId, ref: "Computer" },

    // УБРАЛИ required: true
    // Ссылка на сервер (может быть null, если ВМ на компьютере)
    server: { type: mongoose.Schema.Types.ObjectId, ref: "Server" },

    isPendingDeletion: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Валидация: Гарантируем, что выбран ХОТЯ БЫ ОДИН родитель (но не оба сразу или ни одного)
VirtualMachineSchema.pre("validate", function (next) {
  if (!this.computer && !this.server) {
    next(
      new Error(
        "Virtual Machine must be attached to either a Computer or a Server."
      )
    );
  } else if (this.computer && this.server) {
    next(
      new Error(
        "Virtual Machine cannot be attached to both Computer and Server simultaneously."
      )
    );
  } else {
    next();
  }
});

export default mongoose.model("VirtualMachine", VirtualMachineSchema);
