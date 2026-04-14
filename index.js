const TelegramApi = require('node-telegram-bot-api');
const axios = require('axios');
const schedule = require('node-schedule');
// const Groq = require("groq-sdk"); // Поменяли библиотеку
const { gameOption, againOption, aiOption } = require('./options.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const http = require('http');

// --- СЕРВЕР ДЛЯ RENDER ---
http.createServer((req, res) => res.end('Bot is running')).listen(process.env.PORT || 3000);

// --- КОНФИГУРАЦИЯ ---
const token = process.env.TELEGRAM_BOT_TOKEN; 
// const groqKey = process.env.GROQ_API_KEY;
const WHITE_LIST = [1204470331]; 

// --- ИНИЦИАЛИЗАЦИЯ ---
const bot = new TelegramApi(token, { polling: true });
// const groq = new Groq({ apiKey: groqKey });

const chats = {};   // Хранилище для игры
const aiState = {};

// Исправлено: название переменной и убрана опечатка в process
const googleApiKey = process.env.GOOGLE_API_KEY;
const genAI = new GoogleGenerativeAI(googleApiKey);

// Используем модель с явным указанием версии для обхода ошибок 404
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash" 
}, { apiVersion: 'v1' });

async function getAIResponse(prompt) {
    try {
        // Мы можем добавить системную инструкцию прямо в запрос
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini Error:", error);
        return "🤖 Ошибка связи с Gemini. Проверь VPN или API ключ.";
    }
}

// --- ФУНКЦИЯ ИИ (GROQ) ---
// async function getAIResponse(prompt) {
//     try {
//         const completion = await groq.chat.completions.create({
//             messages: [
//                 {
//                     role: "system",
//                     content: "Ты — полезный ИИ-помощник. Отвечай кратко и по делу на русском языке."
//                 },
//                 {
//                     role: "user",
//                     content: prompt,
//                 },
//             ],
//             model: "llama-3.3-70b-versatile", // Самая быстрая и бесплатная модель
//             temperature: 0.7,
//         });

//         return completion.choices[0]?.message?.content || "🤖 Не удалось сформировать ответ.";
//     } catch (error) {
//         console.error("Groq Error:", error);
//         if (error.status === 429) {
//             return "⚠️ Слишком много запросов! Подожди немного.";
//         }
//         return "🤖 Ошибка связи с ИИ. Проверь API ключ.";
//     }
// }

// Дальше оставляй свой код start() и обработку сообщений без изменений!
const startGame = async (chatId) => {
    const randomNumber = Math.floor(Math.random() * 10);
    chats[chatId] = randomNumber;
    await bot.sendMessage(chatId, `Я загадал число от 0 до 9. Попробуй угадать!`, gameOption);
};

const start = () => {
    // Устанавливаем команды
    bot.setMyCommands([
        { command: '/start', description: 'Запустить бота' },
        { command: '/info', description: 'Информация о себе' },
        { command: '/ai', description: 'Режим ИИ' },
        { command: '/rates', description: 'Курс валют' },
        { command: '/remind', description: 'Напоминание' },
        { command: '/game', description: 'Сыграть в игру' }
    ]);

    bot.on('message', async msg => {
        const text = msg.text;
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!text) return;

        // --- ПРОВЕРКА ДОСТУПА ---
        if (!WHITE_LIST.includes(userId)) {
            return bot.sendMessage(chatId, "⚠️ Извини, это приватный бот. Доступ только для владельца.");
        }

        // 1. Команды
        if (text === '/start') {
            return bot.sendMessage(chatId, `Доступ подтвержден. Привет, Босс!`);
        }

        if (text === '/info') {
            return bot.sendMessage(chatId, `👤 Профиль: ${msg.from.first_name}\n🆔 ID: ${userId}`);
        }

        // 2. Курс валют
        if (text === '/rates') {
            try {
                const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
                const rub = res.data.rates.RUB;
                const kzt = res.data.rates.KZT;
                return bot.sendMessage(chatId, `📈 **Курс валют за 1$:**\n\n🇰🇿 Тенге: **${kzt.toFixed(2)}**\n🇷🇺 Рубль: **${rub.toFixed(2)}**`, { parse_mode: 'Markdown' });
            } catch (e) {
                return bot.sendMessage(chatId, "❌ Ошибка API валют.");
            }
        }

        // 3. Напоминания
        if (text.startsWith('/remind')) {
            const args = text.split(' ');
            const mins = parseInt(args[1]);
            const task = args.slice(2).join(' ');

            if (isNaN(mins) || !task) {
                return bot.sendMessage(chatId, "Используй: `/remind 10 Текст`", { parse_mode: 'Markdown' });
            }

            bot.sendMessage(chatId, `✅ Напомню через ${mins} мин.`);
            const date = new Date(Date.now() + mins * 60000);
            schedule.scheduleJob(date, () => {
                bot.sendMessage(chatId, `🔔 **НАПОМИНАНИЕ:**\n\n> ${task}`, { parse_mode: 'Markdown' });
            });
            return;
        }

        // 4. Игра
        if (text === '/game') return startGame(chatId);

        // 5. Режим ИИ
        if (text === '/ai') {
            aiState[chatId] = true;
            return bot.sendMessage(chatId, "🤖 Режим ИИ включен. Напиши 'Пока', чтобы выключить его.");
        }

        // Логика работы ИИ
        if (aiState[chatId] && !text.startsWith('/')) {
            
            // ПРОВЕРКА НА СТОП-СЛОВО
            const stopWords = ['пока', 'стоп', 'stop', 'выход'];
            if (stopWords.includes(text.toLowerCase().trim())) {
                aiState[chatId] = false; // Выключаем режим
                return bot.sendMessage(chatId, "🤖 Режим ИИ выключен. Был рад помочь!");
            }

            // Если не стоп-слово, отправляем в ИИ
            await bot.sendChatAction(chatId, 'typing');
            const aiAnswer = await getAIResponse(text);
            return bot.sendMessage(chatId, aiAnswer, aiOption);
        }

        if (!text.startsWith('/')) {
            return bot.sendMessage(chatId, "Команда не распознана.");
        }
    });

    // Обработка кнопок
    bot.on('callback_query', async msg => {
        const data = msg.data;
        const chatId = msg.message.chat.id;
        const userId = msg.from.id;

        // Также проверяем доступ для кнопок
        if (!WHITE_LIST.includes(userId)) return bot.answerCallbackQuery(msg.id, {text: "Нет доступа"});

        if (data === '/stop_ai') {
            aiState[chatId] = false;
            await bot.answerCallbackQuery(msg.id);
            return bot.sendMessage(chatId, "🤖 ИИ выключен.");
        }

        if (data === '/again') {
            await bot.answerCallbackQuery(msg.id);
            return startGame(chatId);
        }

        const userGuess = Number(data);
        if (!isNaN(userGuess) && data.length === 1) {
            if (userGuess === chats[chatId]) {
                await bot.sendMessage(chatId, `🎉 Верно!`, againOption);
            } else {
                await bot.sendMessage(chatId, `❌ Нет, это было число ${chats[chatId]}`, againOption);
            }
            await bot.answerCallbackQuery(msg.id);
        }
    });
};

start();
console.log("🚀 Бот запущен в приватном режиме!");