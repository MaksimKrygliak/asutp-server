// import multer from "multer";
// import fs from "fs";

// const storage = multer.diskStorage({
//   destination: (_, __, cb) => {
//     if (!fs.existsSync("uploads")) {
//       fs.mkdirSync("uploads");
//     }
//     cb(null, "uploads");
//   },
//   filename: (_, file, cb) => {
//     cb(null, file.originalname);
//   },
// });

// const upload = multer({ storage });


// export const uploadImg = async (req, res) => {
//     try {
      
//         upload.single("image"), (req, res) => {
//           const imageUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${req.file.filename}`; // Змініть це
//             res.json({ url: imageUrl });
            


//     res.json(post);
//   }catch (err) {
//     console.log(err);
//     res.status(500).json({
//       message: "Не удалось создать статью",
//     });
//   }
// };