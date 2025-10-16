// models/EnclosureItem.js
import mongoose from 'mongoose';

const EnclosureItemSchema = new mongoose.Schema({
  __localId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  title: { type: String, required: true },
  image: { type: String },
  description: { type: String },
  premise: { type: mongoose.Schema.Types.ObjectId, ref: 'Premise' },
  isPendingDeletion: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  terminalBlocks: [{ type: mongoose.Schema.Types.ObjectId }],
});

// Добавляем виртуальное поле для обратной связи (как linkingObjects в Realm)
EnclosureItemSchema.virtual('terminalBlocksVirtual', {
  ref: 'TerminalBlock',
  localField: '_id', // Локальное поле
  foreignField: 'enclosureItem', // Поле с айди родителя в дочернем элементе
});

export default mongoose.model('EnclosureItem', EnclosureItemSchema);