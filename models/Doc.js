import mongoose from "mongoose";

// Определяем SubDocumentMongooseSchema прямо здесь
const SubDocumentMongooseSchema = new mongoose.Schema(
  {
    // _id: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   default: () => new mongoose.Types.ObjectId(),
    // },
    equipment: { type: String, required: false },
    Path: { type: String, required: false },
    Name: { type: String, required: false },
    Page: { type: String, required: false },
    NameImg: { type: String, required: false },
  },
  { _id: true }
);

const DocSchema = new mongoose.Schema(
  {
    __localId: {
      type: mongoose.Schema.Types.ObjectId,
      unique: true,
      required: true,
    },
    idDoc: {
      type: Number,
      unique: true,
      sparse: true,
    },
    pech: {
      type: String,
      required: true,
    },
    location: {
      type: String,
      required: true,
    },
    Enclosure: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isPendingDeletion: { type: Boolean, default: false }, // Флаг мягкого удаления

    // ВАЖНО: Определяем 'documents' как массив объектов, соответствующих SubDocumentMongooseSchema
    documents: [SubDocumentMongooseSchema], // <--- ВОТ ГДЕ ИЗМЕНЕНИЕ
  },
  {
    timestamps: true, // createdAt, updatedAt будут автоматически добавлены Mongoose
  }
);

export default mongoose.model("Doc", DocSchema);
