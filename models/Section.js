// models/Section.js (MongoDB)
import mongoose from 'mongoose';

const SectionSchema = new mongoose.Schema({
  __localId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true }, 
  title: { type: String, required: true }, 
  description: { type: String },
  image: { type: String },
  isPendingDeletion: { type: Boolean, default: false },
  premises: [{ type: mongoose.Schema.Types.ObjectId }],
}, { timestamps: true });

SectionSchema.virtual('premisesVirtual', {
  ref: 'Premise',
  localField: '_id',
  foreignField: 'section', // Поле с айди родителя в дочернем элементе
});

export default mongoose.model('Section', SectionSchema);