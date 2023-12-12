const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const firebaseService = require('./services/firebase.js');
const helmet = require('helmet');

class TCPServer {
    constructor() {
        this.server = null;
        this.initializeServer();
    }

    start(port) {
        try {
            this.server.listen(port, () => {
                console.log(`Server is running on port ${port}`);
            });
        }
        catch (e) {
            console.log('start' + e.message);
        }
    }

    initializeServer() {
        try {
            this.app = express();
            this.server = http.createServer(this.app);

            // Lưu lại 1 Map các id user và Socket của họ để khi server gửi lại thì sẽ biết dùng gửi đến client bằng socket nào
            this.users = new Map();

            // Lưu thông tin 
            this.socketDataMap = new Map();
            this.io = socketIO(this.server, {
                cors: {
                    origin: 'http://localhost:4200',
                    methods: ['GET', 'POST'],
                },
                maxHttpBufferSize: 1e8, // 100MB
                maxWebsocketFrameSize: 1e8, // 100MB
            });

            // Sử dụng Helmet để đặt các tiêu đề bảo mật cho ứng dụng Express
            this.app.use(helmet());

            // Sử dụng middleware cors
            this.app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', 'http://localhost:4200');
                res.header('Access-Control-Allow-Methods', 'GET, POST');
                res.header('Access-Control-Allow-Headers', 'Content-Type');
                res.header("Content-Security-Policy", "default-src 'none'; font-src 'self' https://example.com;");
                next();
            });


            this.io.on('connection', (socket) => {
                this.socketDataMap.set(socket.id, {});
                let currentUserId = '';

                // Dùng 1 mảng lưu lại các ảnh mà user này đã upload, mục đích lưu cả danh sách này vào 1 collection trong 1 message mới
                let uploadDataFiles = [];
                let audioChunksMap = new Map();

                console.log('Client đã kết nối');

                socket.on('login', (data) => {
                    console.log(data.userId, socket.id);
                    currentUserId = data.userId;
                    this.users.set(data.userId, socket);
                });

                socket.on('text', (data) => {
                    console.log('Text: ', data);
                    firebaseService.saveMessageIntoDB(data.chatId, currentUserId, data.text, data.type);
                });

                socket.on('addToGroupChat', (data) => {
                    console.log('Add to group chat: ', data);
                    this.addToGroupChat(currentUserId, data.newUserIds, data.chatId);
                });

                socket.on('audio', (data) => {
                    console.log('audio: ', data);
                    this.combineChunksOfAudio(data, audioChunksMap);
                })

                socket.on('dataFiles', (data) => {
                    console.log('dataFiles: ', data);
                    this.combineChunksOfDataFiles(socket, data, uploadDataFiles, data.type);
                })

                socket.on('callUser', (data) => {
                    const usersSocketOfferedToCall = data.chatUserIds.map((userId) => {
                        return this.users.get(userId);
                    });
                    usersSocketOfferedToCall.forEach((socket) => {
                        if (socket) {
                            console.log('send call-user');
                            socket.emit('callUser', { response: data });
                        }
                    })
                });

                socket.on('answerCall', (data) => {
                    const socketToAnswer = data.chatUserIds.map((userId) => {
                        return this.users.get(userId);
                    });
                    socketToAnswer.forEach((socket) => {
                        if (socket) {
                            console.log('send answer-call');
                            socket.emit('callAccepted', { response: data });
                        }
                    });
                })

                socket.on('disconnect', () => {
                    console.log('Client đã ngắt kết nối');
                    this.users.delete(currentUserId);
                });
            });
        }
        catch (e) {
            console.log('initializeServer' + e.message);
        }
    }

    /**
     * Tiến hành gộp các đoạn của ảnh đã được gửi từ client
     * @param socket: socket của user đang kết nối 
     * @param data:  id, chunkIndex, chunk, totalChunk
     */
    combineChunksOfDataFiles(socket, data, uploadDataFiles, type) {
        try {
            const socketData = this.socketDataMap.get(socket.id);
            if (!socketData[data.dataFileId]) {
                socketData[data.dataFileId] = {};
            }
            socketData[data.dataFileId][data.chunkIndex] = data.chunk;

            const totalChunks = data.totalChunks;
            const receivedChunks = Object.keys(socketData[data.dataFileId]).length;
            if (totalChunks == receivedChunks) {
                // Khi đã nhận đã số chunk đã chia nhỏ của file thì tiến hành gộp lại
                const completeBase64Data = Object.values(socketData[data.dataFileId]).join('');
                delete socketData[data.dataFileId];
                this.saveDataFilesIntoDB(data.fromUser, data.chatId, data.dataFileId, data.fileName, completeBase64Data, uploadDataFiles, data.dataFilesCount, type)
                console.log(`Da gui file ${data.fileName}`);
            }
        }
        catch (e) {
            console.log('combineChunksOfDataFiles' + e.message);
        }
    }

    combineChunksOfAudio(data, audioChunksMap) {
        try {
            const { fromUser, chatId, chunkIndex, chunk, totalChunks } = data;
            if (!audioChunksMap.has(chatId)) {
                audioChunksMap.set(chatId, new Array(totalChunks).fill(null));
            }
            const chunksArray = audioChunksMap.get(chatId);
            chunksArray[chunkIndex] = chunk;
            const hasAllChunks = chunksArray.every((chunk) => chunk !== null);
            if (hasAllChunks) {
                const audioBuffer = Buffer.concat(chunksArray.map((chunk) => Buffer.from(chunk)));
                this.saveAudioIntoDB(fromUser, chatId, audioBuffer)
                audioChunksMap.delete(chatId);
            }
        }
        catch (e) {
            console.log('combineChunksOfAudio' + e.message);
        }
    }

    saveAudioIntoDB(fromUserId, chatId, bufferData) {
        try {
            const fileNameInFirebase = `${new Date().getTime()}_${chatId}.ogg`;
            firebaseService.saveBufferToAudioFolder(bufferData, fileNameInFirebase)
                .then((audioURL) => {
                    firebaseService.saveAudioIntoDB(chatId, fromUserId, audioURL);
                });
        }
        catch (e) {
            console.log('saveAudioIntoDB' + e.message);
        }
    }

    saveDataFilesIntoDB(fromUserId, chatId, dataFileId, fileName, base64Data, uploadDataFiles, dataFilesCount, type) {
        try {
            const fileNameInFirebase = `${new Date().getTime()}_${chatId}_${dataFileId}_${fileName}`;
            firebaseService.saveBase64ToImageFolder(base64Data, fileNameInFirebase, type)
                .then((fileURL) => {
                    uploadDataFiles.push({ fileURL, fileName });
                    if (uploadDataFiles.length === dataFilesCount) {
                        firebaseService.saveDataFilesIntoDB(chatId, fromUserId, uploadDataFiles, type).then(() => {
                            uploadDataFiles.splice(0, uploadDataFiles.length);
                        });
                    }
                });
        }
        catch (e) {
            console.log('saveDataFilesIntoDB' + e.message);
        }
    }

    sendDataToChatRoom(chatId, uploadImages) {
        try {
            firebaseService.getUsersInChatRoom(chatId)
                .then((userIds) => {
                    console.log('Nội dung gửi: ', uploadImages);
                    userIds.forEach((userId) => {
                        const socket = this.users.get(userId);
                        // socket.emit('images', uploadImages);
                    });

                    // Xoá danh sách ảnh đã upload ngay sau khi gửi xong để sẵn sàng nhận cho
                    uploadImages.splice(0, uploadImages.length);
                });
        }
        catch (e) {
            console.log('sendDataToChatRoom' + e.message);
        }
    }

    addToGroupChat(currentUserId, newUserIds, chatId) {
        try {
            const socket = this.users.get(currentUserId);
            socket.emit('addToGroupChat', { newUserIds: newUserIds, chatId: chatId });
        }
        catch (e) {
            console.log('addToGroupChat' + e.message);
        }
    }

}

module.exports = TCPServer;