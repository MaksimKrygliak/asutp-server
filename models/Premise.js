// models/Premise.js
import mongoose from 'mongoose';

const PremiseSchema = new mongoose.Schema({
  __localId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true }, // ID клиента для синхронизации
  title: { type: String, required: true },
  image: { type: String },
  description: { type: String },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section' }, // Ссылка на родительскую секцию
  isPendingDeletion: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  enclosureItems: [{ type: mongoose.Schema.Types.ObjectId }],
}, { timestamps: true });

PremiseSchema.virtual('enclosureItemsVirtual', {
  ref: 'EnclosureItem',
  localField: '_id',
  foreignField: 'premise', // Поле с айди родителя в дочернем элементе
});

export default mongoose.model('Premise', PremiseSchema);