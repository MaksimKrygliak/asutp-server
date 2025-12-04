import mongoose from 'mongoose';

const SignalSchema = new mongoose.Schema({
  __localId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  title: { type: String, required: true },
  address: { type: Number, required: true  },
  description: { type: String },
  minValue: { type: Number },
  maxValue: { type: Number },
  location: { type: String },
  type: { type: String, required: true },
  terminalBlock: { type: mongoose.Schema.Types.ObjectId, ref: 'TerminalBlock' }, // Ссылка на родительский TerminalBlock
  isPendingDeletion: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('Signal', SignalSchema);