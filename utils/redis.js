import { Redis } from '@upstash/redis';
import "dotenv/config";

// Создаем клиент, который автоматически подхватит переменные из .env
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default redis;