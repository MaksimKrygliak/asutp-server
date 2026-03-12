import PremiseModel from "../models/Premise.js";
import SectionModel from "../models/Section.js"; // 🔥 Обов'язково імпортуємо модель локації
import mongoose from "mongoose";
import { universalCascadeDelete } from "../utils/universalCascadeDelete.js";

const ObjectId = mongoose.Types.ObjectId;

// Хелпер для безпечної конвертації в ObjectId
const toObjectId = (val) =>
  val && mongoose.Types.ObjectId.isValid(val) ? new ObjectId(val) : null;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    // 🔥 1. ЗНАХОДИМО СЕКЦІЇ ТА БУДУЄМО КАРТУ (СЛОВНИК)
    const rawSectionIds = newItemsBatch.map((i) => i.section).filter(Boolean);
    const validSectionOids = rawSectionIds.map(toObjectId).filter(Boolean);

    const sections = await SectionModel.find(
      {
        $or: [
          { _id: { $in: validSectionOids } },
          { __localId: { $in: rawSectionIds } },
        ],
      },
      "_id __localId"
    ).lean();

    const sectionMap = new Map();
    sections.forEach((s) => {
      sectionMap.set(s._id.toString(), s._id);
      if (s.__localId) sectionMap.set(s.__localId.toString(), s._id);
    });

    // 2. ФОРМУЄМО ДОКУМЕНТИ ДЛЯ ВСТАВКИ
    const docsToInsert = newItemsBatch.map((item) => {
      // 🔥 Перекладаємо локальний ID секції в серверний ObjectId
      const realSectionId = item.section
        ? sectionMap.get(item.section.toString())
        : null;

      return {
        ...item,
        _id: new ObjectId(),
        __localId: item.__localId,
        section: realSectionId || toObjectId(item.section), // Підставляємо правильний ID!
        createdAt: new Date(),
        updatedAt: new Date(),
        isPendingDeletion: false,
      };
    });

    // 3. МАСОВЕ ЗБЕРЕЖЕННЯ
    await PremiseModel.insertMany(docsToInsert, { ordered: false });

    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId,
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("Premise Create Error:", error);
    res.status(500).json({ message: "Ошибка при создании помещения." });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
    }

    // 🔥 ЗЦІЛЕННЯ ЗВ'ЯЗКІВ ІЗ СЕКЦІЄЮ ПРИ ОНОВЛЕННІ
    const rawSectionIds = updatedItems.map((i) => i.section).filter(Boolean);
    const validSectionOids = rawSectionIds.map(toObjectId).filter(Boolean);

    const sections = await SectionModel.find(
      {
        $or: [
          { _id: { $in: validSectionOids } },
          { __localId: { $in: rawSectionIds } },
        ],
      },
      "_id __localId"
    ).lean();

    const sectionMap = new Map();
    sections.forEach((s) => {
      sectionMap.set(s._id.toString(), s._id);
      if (s.__localId) sectionMap.set(s.__localId.toString(), s._id);
    });

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;
      const updateFields = { ...dataToUpdate, updatedAt: new Date() };

      // 🔥 Підставляємо ObjectId секції, якщо воно є в оновленні
      if (dataToUpdate.hasOwnProperty("section")) {
        const realSectionId = sectionMap.get(dataToUpdate.section?.toString());
        updateFields.section =
          realSectionId || toObjectId(dataToUpdate.section);
      }

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) },
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await PremiseModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("Premise Update Error:", error);
    res.status(500).json({ message: "Ошибка при обновлении помещения." });
  }
};

// --- 3. DELETE BATCH (УНИВЕРСАЛЬНЫЙ КАСКАД) ---
export const deleteBatch = async (req, res) => {
  const { ids } = req.body; // Получаем СЕРВЕРНЫЕ ID от GenericSync

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  const validObjectIds = ids.map(toObjectId).filter(Boolean);

  if (validObjectIds.length === 0) {
    return res.json({ successIds: [], failedIds: [] });
  }

  try {
    // 1. Быстро достаем локальные ID для ответа клиенту
    const itemsToReturn = await PremiseModel.find(
      { _id: { $in: validObjectIds } },
      "__localId"
    ).lean();

    const localIdsToReturn = itemsToReturn
      .map((i) => (i.__localId ? i.__localId.toString() : null))
      .filter(Boolean);

    // 2. 🔥 ВЫЗЫВАЕМ УНИВЕРСАЛЬНУЮ РЕКУРСИЮ!
    // Она сама найдет Серверы, ПК, Шкафы, UPS и пойдет дальше вглубь по графу
    await universalCascadeDelete("Premise", validObjectIds);

    // Возвращаем успех с локальными ID клиенту
    res.json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("Premise Delete Error:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении помещений." });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    const allChanges = await PremiseModel.find({
      $or: [{ createdAt: { $gt: since } }, { updatedAt: { $gt: since } }],
    }).lean();

    const createdOrUpdated = allChanges.filter((doc) => !doc.isPendingDeletion);

    // 🔥 ВОЗВРАЩАЕМ __localId ДЛЯ УДАЛЕННЫХ
    const deletedIds = allChanges
      .filter((doc) => doc.isPendingDeletion)
      .map((d) => (d.__localId ? d.__localId.toString() : null))
      .filter(Boolean);

    const simplifiedItems = createdOrUpdated.map((doc) => ({
      ...doc,
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      section: doc.section ? doc.section.toString() : null,
    }));

    res.json({
      createdOrUpdatedPremises: simplifiedItems,
      deletedPremisesIds: deletedIds, // Возвращаем массив локальных ID
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Premise GetChanges Error:", error);
    res.status(500).json({ message: error.message });
  }
};
