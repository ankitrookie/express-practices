import express, { Request, Response } from 'express'
import { v2 as cloudinary, UploadStream } from 'cloudinary'
import { Twilio } from 'twilio'
import multer from 'multer'
const upload = multer({ dest: 'uploads/' })
import 'dotenv/config'

const app = express()
app.use(express.json()) // build in middleware, it convert incoming req, that has json payload
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT ?? 5000;

// initialize twilio client
const accountSid = process.env.TWILO_ACCOUNT_SID;
const accountToken = process.env.TWILO_AUTH_TOKEN;
const client = new Twilio(accountSid, accountToken);

// configure Cloudinary
cloudinary.config({
	cloud_name: process.env.COOUDINARY_CLOUD_NAME,
	api_key: process.env.COOUDINARY_API_KEY,
	api_secret: process.env.COOUDINARY_API_SECRET,
})

const rateLimitStore = new Map();
const TIME_LIMIT = 15 * 60 * 1000;
const TRY_LIMIT = 16;

const rateLimit = (req: Request) => {
	const ip = req.ip;
	const now = new Date();

	if (!rateLimitStore.has(ip)) {
		rateLimitStore.set(ip, { count: 1, lastRequest: now })
	} else {
		const rateLimitData = rateLimitStore.get(ip)
		if (+now - rateLimitData.lastRequest > TIME_LIMIT) {
			rateLimitStore.set(ip, { count: 1, lastRequest: now })
		} else {
			rateLimitData.count++;
			rateLimitData.lastRequest = now;
			console.log("current number of limit ", rateLimitData.count)

			if (rateLimitData.count > TRY_LIMIT) {
				return false;
			}
		}
	}
	return true;
}

app.get('/', (req: Request, res: Response) => {
	res.send("success")
})

app.post('/report', (req: Request, res: Response) => {
	try {
		if (!rateLimit(req)) {
			res.status(429).json({
				message: "Too many request, please try again later",
			})
			return;
		}
		res.status(200).json({
			message: "Success"
		})
	} catch (err) {
		console.log("error ", err);
		res.status(500).json({
			message: "error accure"
		})
	}
})

app.post('/report-upload', upload.single("fileContent"), async (req: Request, res: Response) => {
	const { fileName } = req.body;
	const fileContent = req.file;

	try {
		if (!(fileContent && fileName)) {
			res.status(400).json({ message: "File name and content are required" })
			return;
		}

		const uploadToCloudinary = new Promise<string>((resolve, reject) => {
			const uploadStream: UploadStream = cloudinary.uploader.upload_stream(
				{ resource_type: "raw", public_id: fileName },
				(err, result) => {
					if (err) {
						return reject(new Error(`Cloudinary upload failed: ${err.message}`))
					}
					if (result && result.secure_url) {
						return resolve(result.secure_url)
					} else {
						return reject(new Error(`Failed to get secure url from cloudinary`))
					}
				}
			)
			uploadStream.end(Buffer.from(fileContent.path))
		})

		const fileUrl = await uploadToCloudinary

		const message = await client.messages.create({
			body: `Here is the approved reports CSV file: ${fileUrl}`,
			from: 'whatsapp:+14155238886',
			to: 'whatsapp:+918904764954' // Replace with your phone number
		});
		console.log('Message sent successfully:', message.sid);

		res.status(200).json({
			message: 'File uploaded and message send successfully', fileUrl,
		})
	} catch (err) {
		console.log("error", err)
		res.status(500).json({ message: 'Failed to precess request' })
	}
})

app.post('/upload', upload.single('fileContent'), async (req: Request, res: Response) => {
	const fileContent = req.file;
	try {
		if (!fileContent) {
			res.status(409).json({ message: "Content required" })
			return;
		}

		const uploadCloudinary = new Promise((resolve, reject) => {
			cloudinary.uploader.upload(
				fileContent.path,
				{ public_id: fileContent.filename },
				(err, result) => {
					if (err) {
						return reject(new Error(`Cloudinary upload failed ${err.message}`))
					}
					if (result && result.url) {
						return resolve(result.url)
					}
					return reject(new Error(`Faild to get URL from Cloudinary`))
				}
			)
		})

		const picUrl = await uploadCloudinary

		console.log("pic URl response ", picUrl)
		res.status(200).json({ message: `Successfully Uploaded ${picUrl}` })
	} catch (err) {
		console.log("error ", err)
		res.status(500).json({ message: "Error accoured while uploading" })
	}
})

app.listen(PORT, () => {
	console.log(`PORT is running at http://localhost:${PORT}`)
}).on('error', (err) => {
	console.log(err)
})
