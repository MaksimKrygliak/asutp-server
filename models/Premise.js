import mongoose from 'mongoose';

const PremiseSchema = new mongoose.Schema({
  __localId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  title: { type: String, required: true },
  image: { type: String },
  position: { type: Number, required: true },
  description: { type: String },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section' }, // Родитель
  isPendingDeletion: { type: Boolean, default: false },

  // 🔥 ВИПРАВЛЕННЯ: Робимо це реальними масивами, щоб контролер міг робити $addToSet
  // Зберігаємо тут __localId дочірніх елементів (або _id, залежно від вашої логіки, але для sync краще те, що ви пушите)
  enclosureItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EnclosureItem' }], 
  computers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Computer' }],
  servers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Server' }],

}, { 
  timestamps: true,
  // virtuals можна залишити true, це не заважає, але для масивів вони вже не потрібні
});

// Віртуали видаляємо або залишаємо тільки якщо потрібна якась специфічна логіка populate по _id,
// але для вашої поточної синхронізації краще використовувати реальні масиви.

export default mongoose.model('Premise', PremiseSchema);