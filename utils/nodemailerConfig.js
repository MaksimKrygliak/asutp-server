import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: "maksimkrygliak@gmail.com",
    pass: "pgaj nvac dezt blol",
  },
});
export default transporter;