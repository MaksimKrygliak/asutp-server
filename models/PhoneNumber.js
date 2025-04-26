import mongoose from 'mongoose';

const PhoneNumberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true, // Или false, если имя не всегда обязательно
    },
    text: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model('PhoneNumber', PhoneNumberSchema);