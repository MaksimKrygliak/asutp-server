import mongoose from "mongoose";

const { Schema } = mongoose;

// 1. Схема поддокумента (SubDocument)
const SubDocumentSchema = new Schema({
  equipment: { type: String, default: "" },
  path: { type: String, default: "" },
  name: { type: String, default: "" },
  page: { type: String, default: "" },
  nameImg: { type: String, default: "" },
});

// 2. Основная схема
const QRDocumentSchema = new Schema(
  {
    // idDoc - числовой ID
    idDoc: {
      type: Number,
      required: true,
      unique: true,
    },

    // __localId для синхронизации
    __localId: { type: String },

    // Связи (References)
    location: {
      type: Schema.Types.ObjectId,
      ref: "Section",
      default: null,
    },
    premise: {
      type: Schema.Types.ObjectId,
      ref: "Premise",
      default: null,
    },
    enclosure: {
      type: Schema.Types.ObjectId,
      ref: "EnclosureItem",
      default: null,
    },

    description: { type: String, default: "" },

    // Массив поддокументов
    documents: [SubDocumentSchema],

    isPendingDeletion: { type: Boolean, default: false },

    // Автор
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true, // Создаст createdAt и updatedAt
  }
);

QRDocumentSchema.index({ isPendingDeletion: 1, updatedAt: -1 }); // Правильный составной для синхронизации
QRDocumentSchema.index({ idDoc: 1 }); // У вас уже стоит unique: true, но явный индекс не помешает
QRDocumentSchema.index({ location: 1 });
QRDocumentSchema.index({ premise: 1 });
QRDocumentSchema.index({ enclosure: 1 });

// 🔥 ВАЖНО: Используем export default вместо module.exports
export default mongoose.model("QRDocument", QRDocumentSchema, "docs");
