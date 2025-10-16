import SectionModel from "../models/Section.js";
import PremiseModel from "../models/Premise.js";
import EnclosureItemModel from "../models/EnclosureItem.js";
import TerminalBlockModel from "../models/TerminalBlock.js";
import SignalModel from "../models/Signal.js";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// --- 1. Пакетное создание новых секций ---
export const createBatch = async (req, res) => {
  const sectionsToProcess = req.body;
  const newSectionsBatch = [];
  const failedNewDocs = [];

  sectionsToProcess.forEach((section) => {
    if (!section.__localId) {
      failedNewDocs.push({
        __localId: "unknown",
        message: "Документ не содержит __localId.",
      });
      return;
    } // Улучшенная проверка на массив premises
    const premisesIds = Array.isArray(section.premises)
      ? section.premises.map((p) => new ObjectId(p))
      : [];
    newSectionsBatch.push({
      __localId: new ObjectId(section.__localId),
      title: section.title,
      image: section.image,
      description: section.description,
      premises: premisesIds,
      isPendingDeletion: section.isPendingDeletion,
    });
  });

  const successNewDocs = [];

  if (newSectionsBatch.length > 0) {
    try {
      const result = await SectionModel.insertMany(newSectionsBatch, {
        ordered: false,
      });

      if (result && result.length > 0) {
        result.forEach((insertedDoc) => {
          successNewDocs.push({
            __localId: insertedDoc.__localId,
            __serverId: insertedDoc._id,
            updatedAt: insertedDoc.updatedAt,
          });
        });
      }
    } catch (error) {
      if (error.code === 11000 && error.insertedDocs) {
        error.insertedDocs.forEach((insertedDoc) => {
          successNewDocs.push({
            __localId: insertedDoc.__localId,
            __serverId: insertedDoc._id,
            updatedAt: insertedDoc.updatedAt,
          });
        });
        error.writeErrors.forEach((writeError) => {
          const failedDoc = newSectionsBatch[writeError.index];
          failedNewDocs.push({
            __localId: failedDoc.__localId,
            message: writeError.errmsg || "Duplicate key error",
            duplicateTitle: failedDoc.title,
          });
        });
      } else {
        console.error("Ошибка при пакетной вставке секций:", error);
        newSectionsBatch.forEach((doc) => {
          failedNewDocs.push({
            __localId: doc.__localId,
            message: error.message || "Insertion failed",
          });
        });
      }
    }
  }

  res.json({ successNewDocs, failedNewDocs });
};

// --- 2. Пакетное обновление существующих секций ---
export const updateBatch = async (req, res) => {
  const sectionsToProcess = req.body;
  if (!Array.isArray(sectionsToProcess) || sectionsToProcess.length === 0) {
    return res.status(400).json({ message: "Нет данных для обновления." });
  }

  const successUpdatedDocs = [];
  const failedUpdatedDocs = []; // Используем for...of для последовательного обновления с await

  for (const doc of sectionsToProcess) {
    const { _id, __localId, ...dataToUpdate } = doc; // 1. Проверка наличия _id
    if (!_id) {
      failedUpdatedDocs.push({
        __localId: __localId || "unknown",
        message: "Документ не содержит _id для обновления.",
      });
      continue;
    } // 2. Валидация ObjectId

    if (!mongoose.Types.ObjectId.isValid(_id)) {
      failedUpdatedDocs.push({
        __localId,
        _id,
        message: "Неверный формат _id.",
      });
      continue;
    } // 3. Преобразование массива дочерних ID в ObjectId

    if (dataToUpdate.premises && Array.isArray(dataToUpdate.premises)) {
      dataToUpdate.premises = dataToUpdate.premises
        .map((p) => {
          try {
            return new ObjectId(p);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
    } // NOTE: Важно помнить, что в updateBatch приходят только изменения. // Если клиент добавляет дочерний элемент, он должен послать ПОЛНЫЙ массив premises. // Если клиент удаляет дочерний элемент, он должен послать ПОЛНЫЙ массив premises БЕЗ удаленного ID.
    try {
      // 4. Находим и обновляем документ
      const updatedSection = await SectionModel.findByIdAndUpdate(
        new ObjectId(_id),
        {
          $set: { ...dataToUpdate, updatedAt: new Date() }, // Используем $set для обновления только предоставленных полей
        },
        { new: true, runValidators: true } // Вернуть обновленный документ, запустить валидацию
      );

      if (updatedSection) {
        // Если документ найден и обновлен
        successUpdatedDocs.push({
          __localId: __localId,
          _id: updatedSection._id.toString(),
          updatedAt: updatedSection.updatedAt,
        });
      } else {
        // Если документ не найден
        failedUpdatedDocs.push({
          __localId,
          _id,
          message: "Секция не найдена на сервере.",
        });
      }
    } catch (error) {
      // console.error(`Ошибка при обновлении секции ${_id}:`, error);
      failedUpdatedDocs.push({
        __localId,
        _id,
        message: error.message || "Ошибка сервера во время обновления.",
      });
    }
  } // Возвращаем результаты пакетного обновления

  if (failedUpdatedDocs.length > 0) {
    return res.status(207).json({
      message: "Пакетное обновление завершено с некоторыми ошибками.",
      successUpdatedDocs,
      failedUpdatedDocs,
    });
  } else {
    return res.status(200).json({
      message: "Все секции успешно обновлены.",
      successUpdatedDocs,
    });
  }
};

// --- 3. Пакетное удаление секций ---
export const deleteBatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { ids: idsToDelete } = req.body; // Получаем массив СЕРВЕРНЫХ ID (строки)

    if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
      session.endSession();
      return res.status(400).json({ message: "Нет ID для удаления." });
    }

    // 1. Валидация и подготовка ID
    const validIdMap = new Map();
    idsToDelete.forEach((idString) => {
      if (
        typeof idString === "string" &&
        mongoose.Types.ObjectId.isValid(idString)
      ) {
        validIdMap.set(idString, new mongoose.Types.ObjectId(idString));
      }
    });

    const validObjectIds = Array.from(validIdMap.values());
    const initialValidIdStrings = Array.from(validIdMap.keys()); // Исходные валидные строки ID

    if (validObjectIds.length === 0) {
      session.endSession();
      return res.status(400).json({ message: "Некорректные ID для удаления." });
    }

    // 2. Находим документы, которые существуют и могут быть живыми или уже помеченными.
    const sectionsFound = await SectionModel.find({
      _id: { $in: validObjectIds },
    })
      .session(session)
      .select("_id __localId isPendingDeletion");

    // 3. Определяем, какие ID уже были удалены (не найдены)
    const successfullyFoundIds = sectionsFound.map((doc) =>
      doc._id.toHexString()
    );

    // ID, которые были в исходном запросе, но НЕ найдены в базе (уже удалены).
    const alreadyDeletedIds = initialValidIdStrings.filter((idString) => {
      return !successfullyFoundIds.includes(idString);
    });

    // 4. Определяем, какие секции нужно *действительно* обработать каскадно (только живые)
    const sectionsForSoftDelete = sectionsFound.filter(
      (s) => s.isPendingDeletion === false
    );
    const sectionLocalIDs = sectionsForSoftDelete.map(
      (section) => section.__localId
    );

    // 5. Обработка случая, когда нет новых секций для мягкого удаления
    if (sectionsForSoftDelete.length === 0) {
      await session.commitTransaction();

      // Возвращаем все валидные ID как успешно обработанные,
      // так как сервер подтверждает, что их больше нет (либо удалены, либо помечены).
      return res.status(200).json({
        message:
          "Все запрошенные локации уже помечены на удаление или не найдены.",
        // successDeletedDocIds: Все найденные + все, которые не найдены (alreadyDeletedIds)
        successDeletedDocIds: initialValidIdStrings,
        failedDeletedDocIds: [],
      });
    }

    // --- 6. КАСКАДНЫЙ ПОИСК И МЯГКОЕ УДАЛЕНИЕ (ТОЛЬКО ДЛЯ ЖИВЫХ SECTIONS) ---

    // 6a. Premises
    const premisesToUpdate = await PremiseModel.find({
      section: { $in: sectionLocalIDs },
      isPendingDeletion: false,
    })
      .session(session)
      .select("__localId");
    const premiseLocalIDs = premisesToUpdate.map(
      (premise) => premise.__localId
    );

    // 6b. EnclosureItem
    let enclosureItemLocalIDs = [];
    if (premiseLocalIDs.length > 0) {
      const enclosureItemsToUpdate = await EnclosureItemModel.find({
        premise: { $in: premiseLocalIDs },
        isPendingDeletion: false,
      })
        .session(session)
        .select("__localId");
      enclosureItemLocalIDs = enclosureItemsToUpdate.map(
        (doc) => doc.__localId
      );
    }

    // 6c. TerminalBlock
    let terminalBlockLocalIDs = [];
    if (enclosureItemLocalIDs.length > 0) {
      const terminalBlocksToUpdate = await TerminalBlockModel.find({
        enclosureItem: { $in: enclosureItemLocalIDs },
        isPendingDeletion: false,
      })
        .session(session)
        .select("__localId");
      terminalBlockLocalIDs = terminalBlocksToUpdate.map(
        (doc) => doc.__localId
      );
    }

    // 6d. Signal
    let signalLocalIDs = [];
    if (terminalBlockLocalIDs.length > 0) {
      const signalsToUpdate = await SignalModel.find({
        terminalBlock: { $in: terminalBlockLocalIDs },
        isPendingDeletion: false,
      })
        .session(session)
        .select("__localId");
      signalLocalIDs = signalsToUpdate.map((doc) => doc.__localId);
    }

    // --- 7. МЯГКОЕ УДАЛЕНИЕ (ОБРАТНЫЙ ПОРЯДОК) ---

    if (signalLocalIDs.length > 0) {
      await SignalModel.updateMany(
        { __localId: { $in: signalLocalIDs } },
        { $set: { isPendingDeletion: true, updatedAt: new Date() } },
        { session: session }
      );
    }

    if (terminalBlockLocalIDs.length > 0) {
      await TerminalBlockModel.updateMany(
        { __localId: { $in: terminalBlockLocalIDs } },
        {
          $set: { signals: [], isPendingDeletion: true, updatedAt: new Date() },
        },
        { session: session }
      );
    }

    if (enclosureItemLocalIDs.length > 0) {
      await EnclosureItemModel.updateMany(
        { __localId: { $in: enclosureItemLocalIDs } },
        {
          $set: {
            terminalBlocks: [],
            isPendingDeletion: true,
            updatedAt: new Date(),
          },
        },
        { session: session }
      );
    }

    if (premiseLocalIDs.length > 0) {
      await PremiseModel.updateMany(
        { __localId: { $in: premiseLocalIDs } },
        {
          $set: {
            enclosureItems: [],
            isPendingDeletion: true,
            updatedAt: new Date(),
          },
        },
        { session: session }
      );
    }

    // 7e. Section (помечаем на удаление по СЕРВЕРНОМУ ID)
    const serverIdsToUpdate = sectionsForSoftDelete.map((s) => s._id);

    const result = await SectionModel.updateMany(
      { _id: { $in: serverIdsToUpdate } },
      {
        $set: { premises: [], isPendingDeletion: true, updatedAt: new Date() },
      },
      { session: session }
    );

    // 8. ФИНАЛЬНЫЙ ОТВЕТ

    await session.commitTransaction();

    // successDeletedDocIds: успешно помеченные (sectionsForSoftDelete) ИЛИ те, что уже были удалены (alreadyDeletedIds)
    const finalSuccessIds = [
      ...sectionsForSoftDelete.map((s) => s._id.toHexString()),
      ...alreadyDeletedIds,
    ];

    // failedDeletedDocIds: ID, которые не смогли быть обработаны из-за ошибки (здесь они должны быть пусты)
    const finalFailedIds = initialValidIdStrings.filter(
      (id) => !finalSuccessIds.includes(id)
    );

    return res.status(200).json({
      message: `Успешно помечено на удаление ${result.modifiedCount} локаций. Учтено ${alreadyDeletedIds.length} уже удаленных.`,
      successDeletedDocIds: finalSuccessIds,
      failedDeletedDocIds: finalFailedIds, // Должен быть пустым
    });
  } catch (error) {
    await session.abortTransaction();
    console.error(
      "Ошибка пакетного мягкого удаления локаций (SectionModel):",
      error
    );
    return res.status(500).json({
      message: "Не удалось выполнить пакетное мягкое удаление локаций.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};
// export const deleteBatch = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { ids: idsToDelete } = req.body; // Получаем массив СЕРВЕРНЫХ ID

//     if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
//       await session.commitTransaction();
//       return res.status(400).json({ message: "Нет ID для удаления." });
//     } // 1. Фильтрация и преобразование СЕРВЕРНЫХ ID

//     const validObjectIds = idsToDelete
//       .filter(
//         (id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id)
//       )
//       .map((id) => new mongoose.Types.ObjectId(id));

//     if (validObjectIds.length === 0) {
//       await session.commitTransaction();
//       return res.status(400).json({ message: "Некорректные ID для удаления." });
//     } // 2. Находим документы, которые существуют. Мы ищем все, даже помеченные на удаление (isPendingDeletion), // чтобы корректно сообщить клиенту об успехе, если документ уже был удален.

//     const sectionsFound = await SectionModel.find({
//       _id: { $in: validObjectIds },
//     })
//       .session(session)
//       .select("_id __localId isPendingDeletion"); // Сохраняем флаг // Определяем, какие ID действительно существуют в базе

//     const successDeletedDocIds = sectionsFound.map((doc) => doc._id.toString());
//     const failedDeletedDocIds = idsToDelete.filter(
//       (id) => !successDeletedDocIds.includes(id)
//     ); // 3. Определяем, какие секции нужно обработать каскадно (те, которые не помечены на удаление)

//     const sectionsForSoftDelete = sectionsFound.filter(
//       (s) => s.isPendingDeletion === false
//     );
//     const sectionLocalIDs = sectionsForSoftDelete.map(
//       (section) => section.__localId
//     ); // Если нет секций, которые нужно удалить или каскадно обработать, завершаем
//     if (sectionsForSoftDelete.length === 0) {
//       await session.commitTransaction();
//       return res.status(200).json({
//         successDeletedDocIds: successDeletedDocIds, // Возвращаем все найденные ID как успешные
//         failedDeletedDocIds: failedDeletedDocIds, // Возвращаем только те, что не найдены
//       });
//     } // --- 4. КАСКАДНЫЙ ПОИСК И МЯГКОЕ УДАЛЕНИЕ (ВОССТАНОВЛЕННЫЕ ЧАСТИ) --- // 4a. Premises

//     const premisesToUpdate = await PremiseModel.find({
//       section: { $in: sectionLocalIDs },
//       isPendingDeletion: false,
//     })
//       .session(session)
//       .select("__localId");
//     const premiseLocalIDs = premisesToUpdate.map(
//       (premise) => premise.__localId
//     ); // 4b. EnclosureItem

//     let enclosureItemLocalIDs = [];
//     if (premiseLocalIDs.length > 0) {
//       const enclosureItemsToUpdate = await EnclosureItemModel.find({
//         premise: { $in: premiseLocalIDs },
//         isPendingDeletion: false,
//       })
//         .session(session)
//         .select("__localId");
//       enclosureItemLocalIDs = enclosureItemsToUpdate.map(
//         (doc) => doc.__localId
//       );
//     } // 4c. TerminalBlock

//     let terminalBlockLocalIDs = [];
//     if (enclosureItemLocalIDs.length > 0) {
//       const terminalBlocksToUpdate = await TerminalBlockModel.find({
//         enclosureItem: { $in: enclosureItemLocalIDs },
//         isPendingDeletion: false,
//       })
//         .session(session)
//         .select("__localId");
//       terminalBlockLocalIDs = terminalBlocksToUpdate.map(
//         (doc) => doc.__localId
//       );
//     } // 4d. Signal

//     let signalLocalIDs = [];
//     if (terminalBlockLocalIDs.length > 0) {
//       const signalsToUpdate = await SignalModel.find({
//         terminalBlock: { $in: terminalBlockLocalIDs },
//         isPendingDeletion: false,
//       })
//         .session(session)
//         .select("__localId");
//       signalLocalIDs = signalsToUpdate.map((doc) => doc.__localId);
//     } // --- 5. МЯГКОЕ УДАЛЕНИЕ (ОБРАТНЫЙ ПОРЯДОК) ---

//     if (signalLocalIDs.length > 0) {
//       await SignalModel.updateMany(
//         { __localId: { $in: signalLocalIDs } },
//         { $set: { isPendingDeletion: true, updatedAt: new Date() } },
//         { session: session }
//       );
//     }

//     if (terminalBlockLocalIDs.length > 0) {
//       await TerminalBlockModel.updateMany(
//         { __localId: { $in: terminalBlockLocalIDs } },
//         {
//           $set: { signals: [], isPendingDeletion: true, updatedAt: new Date() },
//         },
//         { session: session }
//       );
//     }

//     if (enclosureItemLocalIDs.length > 0) {
//       await EnclosureItemModel.updateMany(
//         { __localId: { $in: enclosureItemLocalIDs } },
//         {
//           $set: {
//             terminalBlocks: [],
//             isPendingDeletion: true,
//             updatedAt: new Date(),
//           },
//         },
//         { session: session }
//       );
//     }

//     if (premiseLocalIDs.length > 0) {
//       await PremiseModel.updateMany(
//         { __localId: { $in: premiseLocalIDs } },
//         {
//           $set: {
//             enclosureItems: [],
//             isPendingDeletion: true,
//             updatedAt: new Date(),
//           },
//         },
//         { session: session }
//       );
//     } // 5e. Section (помечаем на удаление по СЕРВЕРНОМУ ID)

//     const serverIdsToUpdate = sectionsForSoftDelete.map((s) => s._id);

//     await SectionModel.updateMany(
//       { _id: { $in: serverIdsToUpdate } },
//       {
//         $set: { premises: [], isPendingDeletion: true, updatedAt: new Date() },
//       },
//       { session: session }
//     ); // 6. Логика определения успеха/неудачи (теперь successDeletedDocIds определен)

//     await session.commitTransaction();
//     res.json({
//       successDeletedDocIds: successDeletedDocIds,
//       failedDeletedDocIds: failedDeletedDocIds,
//     });
//   } catch (error) {
//     await session.abortTransaction();
//     console.error(
//       "Ошибка пакетного мягкого удаления локаций (SectionModel):",
//       error
//     );
//     res.status(500).json({
//       message: "Не удалось выполнить пакетное мягкое удаление локаций.",
//       error: error.message,
//     });
//   } finally {
//     session.endSession();
//   }
// };

// --- 4. Получение изменений для Pull-синхронизации ---
export const getChanges = async (req, res) => {
  const since = req.query.since
    ? new Date(req.query.since)
    : console.log("since не получен");

  try {
    const createdOrUpdatedSections = await SectionModel.find({
      $or: [
        { updatedAt: { $gte: since }, isPendingDeletion: false }, // Обновленные и не удаленные
        { createdAt: { $gte: since }, isPendingDeletion: false }, // Вновь созданные и не удаленные
      ],
    }) // .populate("user") // Если поле 'user' это ObjectId и вы хотите подтянуть данные пользователя
      .lean() // Преобразует Mongoose-документы в простые JavaScript-объекты для чистоты
      .exec();

    const deletedSectionsIds = await SectionModel.find(
      {
        isPendingDeletion: true,
        updatedAt: { $gte: since },
      },
      "_id"
    ) // Проекция: возвращаем только поле _id
      .lean()
      .exec()
      .then((sections) => sections.map((doc) => doc._id.toString())); // Преобразуем ObjectId в строки

    const serverCurrentTimestamp = new Date().toISOString();

    res.json({
      createdOrUpdatedSections,
      deletedSectionsIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Ошибка при получении изменений секций:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
