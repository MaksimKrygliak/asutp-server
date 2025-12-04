// models/EnclosureItem.js
import mongoose from 'mongoose';

const TerminalBlockSchema = new mongoose.Schema({
  __localId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  position: { type: Number, required: true },
  enclosureItem: { type: mongoose.Schema.Types.ObjectId, ref: 'EnclosureItem' }, // Ссылка на родительский EnclosureItem
  isPendingDeletion: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  signals: [{ type: mongoose.Schema.Types.ObjectId }],
});

// Дополнительно можно добавить виртуальное поле для обратной связи
TerminalBlockSchema.virtual('signalsVirtual', {
  ref: 'Signal',
  localField: '_id', // Локальное поле
  foreignField: 'terminalBlock', // Поле с айди родителя в дочернем элементе
});

export default mongoose.model('TerminalBlock', TerminalBlockSchema);