import PremiseModel from "../models/Premise.js";
import SectionModel from "../models/Section.js";
import mongoose from "mongoose";
import { universalCascadeDelete } from "../utils/universalCascadeDelete.js";

const ObjectId = mongoose.Types.ObjectId;

// Хелпер для безопасной конвертации в ObjectId
const toObjectId = (val) =>
  val && mongoose.Types.ObjectId.isValid(val) ? new ObjectId(val) : null;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const arrPremises = req.body;
    if (!Array.isArray(arrPremises) || arrPremises.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    // 1. СОБИРАЕМ ТОЛЬКО ЛОКАЛЬНЫЕ ID ЛОКАЦИЙ (СЕКЦИЙ) ИЗ ЗАПРОСА
    const rawSectionIds = arrPremises.map((i) => i.section).filter(Boolean);

    // 2. ИЩЕМ ЛОКАЦИИ В БАЗЕ СТРОГО ПО __localId (БЕЗ КОНВЕРТАЦИЙ)
    const sections = await SectionModel.find(
      { __localId: { $in: rawSectionIds } },
      "_id __localId"
    ).lean();

    // 3. СТРОИМ КАРТУ: "Строковый UUID локации -> Серверный ObjectId локации"
    const sectionMap = new Map();
    sections.forEach((s) => {
      if (s.__localId) sectionMap.set(s.__localId.toString(), s._id);
    });

    // 4. ФОРМИРУЕМ ДОКУМЕНТЫ ДЛЯ ВСТАВКИ
    const docsToInsert = arrPremises
      .map((item) => {
        // 🔥 Берем настоящий серверный ObjectId родителя из Карты
        const realSectionId = item.section
          ? sectionMap.get(item.section)
          : null;
        return {
          ...item,
          _id: new ObjectId(), // Генерируем новый серверный ID для помещения
          __localId: item.__localId, // Оставляем строкой (UUID клиента)
          section: realSectionId, // Сохраняем чистый ObjectId родительской локации!
          createdAt: new Date(),
          updatedAt: new Date(),
          isPendingDeletion: false,
        };
      })
      .filter((doc) => doc.section); // Отфильтровываем "сирот" (если локация не найдена)

    // 5. МАССОВОЕ СОХРАНЕНИЕ
    if (docsToInsert.length > 0) {
      await PremiseModel.insertMany(docsToInsert, { ordered: false });
    }

    // 6. ОТВЕТ КЛИЕНТУ
    const successNewDocs = docsToInsert.map((doc) => ({
      __localId: doc.__localId, // Возвращаем клиенту его UUID
      _id: doc._id.toString(), // Возвращаем клиенту новый серверный _id
      updatedAt: doc.updatedAt,
    }));

    res.status(200).json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("Premise Create Error:", error);
    res.status(500).json({ message: "Ошибка сервера при создании." });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedDocs = req.body;
    if (!Array.isArray(updatedDocs) || updatedDocs.length === 0) {
      return res.status(400).json({ message: "Нет данных." });
    }

    const bulkUpdateOps = updatedDocs.map((doc) => {
      const { _id, __localId, section, ...fieldsToUpdate } = doc;
      const updateData = { ...fieldsToUpdate, updatedAt: new Date() };

      // Если пришла секция - значит это валидный серверный ID
      if (section) {
        updateData.section = toObjectId(section);
      }

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) }, // Поиск по серверному ID
          update: { $set: updateData },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await PremiseModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedDocs.map((doc) => ({
      __localId: doc.__localId,
      _id: doc._id,
      updatedAt: new Date(),
    }));

    res.status(200).json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("Premise Update Error:", error);
    res.status(500).json({ message: "Ошибка сервера при обновлении." });
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
