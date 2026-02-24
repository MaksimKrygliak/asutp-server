import mongoose from "mongoose";

const SignalSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    title: { type: String, required: true },
    address: { type: Number, required: true },
    description: { type: String },
    minValue: { type: Number },
    maxValue: { type: Number },
    location: { type: String },
    type: { type: String, required: true },

    // Ссылка на родительский TerminalBlock
    terminalBlock: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TerminalBlock",
      required: true,
    },

    isPendingDeletion: { type: Boolean, default: false },
  },
  {
    timestamps: true, // Автоматически создаст и будет обновлять createdAt и updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

SignalSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Для синхронизации
SignalSchema.index({ terminalBlock: 1 });

export default mongoose.model("Signal", SignalSchema);
