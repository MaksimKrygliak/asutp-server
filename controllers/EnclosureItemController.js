import EnclosureItemModel from "../models/EnclosureItem.js";
import PremiseModel from "../models/Premise.js"; // Нам нужна модель родителя для поиска настоящего _id
import mongoose from "mongoose";
import { universalCascadeDelete } from "../utils/universalCascadeDelete.js"; // Универсальное удаление

const ObjectId = mongoose.Types.ObjectId;

// Хелпер для безопасной конвертации в ObjectId
const toObjectId = (val) =>
  val && mongoose.Types.ObjectId.isValid(val) ? new ObjectId(val) : null;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ: Находим настоящие серверные _id помещений
    // Собираем все переданные ID помещений (они могут быть локальными или серверными)
    const rawPremiseIds = newItemsBatch.map((i) => i.premise).filter(Boolean);

    // Ищем их в базе (сразу и по _id, и по __localId)
    const validPremiseOids = rawPremiseIds.map(toObjectId).filter(Boolean);
    const premises = await PremiseModel.find(
      {
        $or: [
          { _id: { $in: validPremiseOids } },
          { __localId: { $in: rawPremiseIds } }, // На случай, если __localId сохранен как строка
        ],
      },
      "_id __localId"
    ).lean();

    // Создаем карту для быстрого сопоставления: "Любой ID -> Настоящий серверный _id"
    const premiseMap = new Map();
    premises.forEach((p) => {
      premiseMap.set(p._id.toString(), p._id);
      if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
    });

    // Формируем документы для вставки
    const docsToInsert = newItemsBatch.map((item) => {
      // Пытаемся получить настоящий серверный _id из нашей карты. Если не нашли - ставим null.
      const realPremiseId = item.premise
        ? premiseMap.get(item.premise.toString())
        : null;

      return {
        ...item,
        _id: new ObjectId(),
        __localId: toObjectId(item.__localId),
        premise: realPremiseId, // ✅ ТЕПЕРЬ ТУТ 100% ПРАВИЛЬНЫЙ СЕРВЕРНЫЙ ID
        createdAt: new Date(),
        updatedAt: new Date(),
        isPendingDeletion: false,
      };
    });

    await EnclosureItemModel.insertMany(docsToInsert, { ordered: false });

    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("EnclosureItem Create Error:", error);
    res.status(500).json({ message: "Ошибка при создании шкафов." });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
    }

    // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ ДЛЯ ОБНОВЛЕНИЯ
    const rawPremiseIds = updatedItems.map((i) => i.premise).filter(Boolean);
    const validPremiseOids = rawPremiseIds.map(toObjectId).filter(Boolean);

    const premises = await PremiseModel.find(
      {
        $or: [
          { _id: { $in: validPremiseOids } },
          { __localId: { $in: rawPremiseIds } },
        ],
      },
      "_id __localId"
    ).lean();

    const premiseMap = new Map();
    premises.forEach((p) => {
      premiseMap.set(p._id.toString(), p._id);
      if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
    });

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;
      const updateFields = { ...dataToUpdate, updatedAt: new Date() };

      if (dataToUpdate.premise) {
        const realPremiseId = premiseMap.get(dataToUpdate.premise.toString());
        updateFields.premise =
          realPremiseId || toObjectId(dataToUpdate.premise);
      }

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) }, // Поиск шкафа по серверному ID
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await EnclosureItemModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("Enclosure Update Error:", error);
    res.status(500).json({ message: "Ошибка при обновлении шкафов." });
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
    // 1. Достаем локальные ID для ответа клиенту
    const itemsToReturn = await EnclosureItemModel.find(
      { _id: { $in: validObjectIds } },
      "__localId"
    ).lean();

    const localIdsToReturn = itemsToReturn
      .map((i) => (i.__localId ? i.__localId.toString() : null))
      .filter(Boolean);

    // 2. 🔥 ВЫЗЫВАЕМ УНИВЕРСАЛЬНУЮ РЕКУРСИЮ!
    // Она сама найдет Клеммники и Сигналы и проставит им isPendingDeletion
    await universalCascadeDelete("EnclosureItem", validObjectIds);

    // Возвращаем успех с локальными ID
    res.json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("Enclosure Delete Error:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении шкафов." });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    const allChanges = await EnclosureItemModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    }).lean();

    const createdOrUpdated = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    // 🔥 ВОЗВРАЩАЕМ __localId ДЛЯ УДАЛЕННЫХ
    const deletedIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => (item.__localId ? item.__localId.toString() : null))
      .filter(Boolean);

    const simplifiedItems = createdOrUpdated.map((item) => ({
      ...item,
      _id: item._id.toString(),
      __localId: item.__localId.toString(),
      premise: item.premise ? item.premise.toString() : null,
    }));

    res.json({
      createdOrUpdatedEnclosureItems: simplifiedItems,
      deletedEnclosureItemIds: deletedIds, // Возвращаем локальные ID
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Enclosure GetChanges Error:", error);
    res.status(500).json({ message: "Не удалось получить изменения." });
  }
};
