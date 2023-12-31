const admin = require('firebase-admin');
const uuid = require('uuid');
const serviceAccount = require('../firebase-admin-key.json');
const storageBucketName = 'chatappstinger.appspot.com';

class FirebaseService {
    constructor() {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: storageBucketName
        });

        this.bucket = admin.storage().bucket();
    }

    async saveBase64ToImageFolder(base64Data, fileName, type) {
        try {
            // Do base64 đọc lúc đọc file có xuất hiện data:image/png;base64, ở phía trước nên ta cần loại bỏ nó trước khi lưu vào firebase
            const base64 = base64Data.split(',')[1];
            const buffer = Buffer.from(base64, 'base64');

            // Tạo ra 1 đường dẫn lưu trong thư mục images
            const file = this.bucket.file(`${type}s/${fileName}`);
            await file.save(buffer, {
                metadata: {
                    content: 'image/jpeg'
                }
            });

            // Lấy đường link mà ta đã lưu ảnh vào Storage
            const [url] = await file.getSignedUrl({
                action: 'read',
                // Nếu không chỉ định expires thì thời hạn của url này chỉ được 15 phút
                expires: '01-01-2100'
            });

            return url;
        }
        catch (e) {
            console.log('saveBase64ToImageFolder' + e.message);
        }
    }

    async saveBufferToAudioFolder(bufferData, fileName) {
        try {
            const file = this.bucket.file(`audios/${fileName}`);
            await file.save(bufferData, {
                metadata: {
                    content: 'audio/ogg'
                }
            });
            const [url] = await file.getSignedUrl({
                action: 'read',
                expires: '01-01-2100'
            });
            return url;
        }
        catch (e) {
            console.log('saveBufferToAudioFolder' + e.message);
        }
    }

    async saveAudioIntoDB(chatId, fromUserId, audioURL) {
        try {
            const db = admin.firestore();
            const userRef = db.collection('users').doc(fromUserId);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const chatRef = db.collection('chats').doc(chatId);
                const messageCollection = chatRef.collection('messages');
                const today = admin.firestore.FieldValue.serverTimestamp();
                const messageId = uuid.v4();

                await chatRef.update({
                    fromUser: {
                        userId: fromUserId,
                        displayName: `${userDoc.data()['displayName']}`,
                    },
                    messageId: messageId,
                    lastMessage: `audio.xyz`,
                    lastMessageDate: today,
                });

                await messageCollection.doc(messageId).set({
                    id: messageId,
                    senderId: fromUserId,
                    displayName: userDoc.data()['displayName'],
                    sentDate: today,
                    avatar: userDoc.data()['photoURL'],
                    text: audioURL,
                    type: 'audio'
                });
                return today;
            }
        }
        catch (e) {
            console.log('saveAudioIntoDB' + e.message);
        }
    }

    async saveDataFilesIntoDB(chatId, fromUserId, uploadDataFiles, type) {
        try {
            const db = admin.firestore();
            const userRef = db.collection('users').doc(fromUserId);
            const userDoc = await userRef.get();
            const today = admin.firestore.FieldValue.serverTimestamp();
            if (userDoc.exists) {
                const chatRef = db.collection('chats').doc(chatId);
                const messageCollection = chatRef.collection('messages');
                const messageId = uuid.v4();

                await chatRef.update({
                    fromUser: {
                        userId: fromUserId,
                        displayName: `${userDoc.data()['displayName']}`,
                    },
                    messageId: messageId,
                    lastMessage: `had sent ${uploadDataFiles.length} ${type}(s).`,
                    lastMessageDate: today,
                });

                await messageCollection.doc(messageId).set({
                    id: messageId,
                    senderId: fromUserId,
                    displayName: userDoc.data()['displayName'],
                    sentDate: today,
                    avatar: userDoc.data()['photoURL'],
                    dataFiles: uploadDataFiles,
                    type: type
                });
                return today;
            }
        }
        catch (e) {
            console.log('saveDataFilesIntoDB' + e.message);
        }
    }

    async saveMessageIntoDB(chatId, fromUserId, message, type) {
        try {
            const db = admin.firestore();
            const batch = db.batch();
            const userRef = db.collection('users').doc(fromUserId);
            const userDoc = await userRef.get();
            const today = admin.firestore.FieldValue.serverTimestamp();
            if (userDoc.exists) {
                const chatRef = db.collection('chats').doc(chatId);
                const messageCollection = chatRef.collection('messages');

                const messageId = uuid.v4();
                batch.update(chatRef, {
                    fromUser: {
                        userId: fromUserId,
                        displayName: `${userDoc.data()['displayName']}`,
                    },
                    messageId: messageId,
                    lastMessage: (type === 'link') ? 'link.xyz' : `: ${message.replaceAll('<br/>', '\n')}`,
                    lastMessageDate: today
                });

                batch.set(messageCollection.doc(messageId), {
                    id: messageId,
                    senderId: fromUserId,
                    displayName: userDoc.data()['displayName'],
                    sentDate: today,
                    avatar: userDoc.data()['photoURL'],
                    text: message,
                    type: type
                });

                await batch.commit();
                return today;
            }
        }
        catch (e) {
            console.log('saveMessageIntoDB' + e.message);
        }
    }

    async saveDataInNotification(fromUserId, toUserId, chatId, data) {
        try {
            const db = admin.firestore();
            const userDoc = await this.getUserDoc(fromUserId);

            if (userDoc.exists) {
                const today = data?.sendAt ?? admin.firestore.FieldValue.serverTimestamp();
                let groupChatName = '';
                if (chatId) {
                    const chatRef = db.collection('chats').doc(chatId);
                    groupChatName = (await chatRef.get()).data()['groupChatName'] ?? '';
                }

                let content = data.content;
                if (data.type === 'image') {
                    content = `${userDoc.data()['displayName']} has sent ${data.quantity} image(s)`;
                }
                await db.collection('notifications').add({
                    senderId: fromUserId,
                    senderName: userDoc.data()['displayName'],
                    senderAvatar: userDoc.data()['photoURL'],
                    receiverId: toUserId,
                    chatId,
                    groupChatName,
                    content,
                    type: data.type,
                    sendAt: today,
                    isSeen: false
                });
            }
            console.log('saveDataInNotification end.');
        } catch (error) {
            console.log('saveDataInNotification: ', error.message);
        }
    }

    async getUsersInChatRoom(chatId) {
        try {
            const db = admin.firestore();
            const chatRef = db.collection('chats').doc(chatId);
            const chatDoc = await chatRef.get();
            if (chatDoc.exists) {
                return chatDoc.data()['userIds'];
            }
            return [];
        }
        catch (e) {
            console.log('getUsersInChatRoom' + e.message);
        }
    }

    async editMessageContent(chatId, messageId, newContent) {
        try {
            const db = admin.firestore();
            const chatRef = db.collection('chats').doc(chatId);
            const messageRef = chatRef.collection('messages').doc(messageId);

            await db.runTransaction(async (transaction) => {
                const chatDoc = await transaction.get(chatRef);
                if (chatDoc.exists && chatDoc.data()['messageId'] === messageId) {
                    transaction.update(chatRef, { lastMessage: `: ${newContent}` });
                }

                // Cập nhật thông tin của message
                transaction.update(messageRef, {
                    text: newContent,
                    isEdited: true,
                });
            });
            console.log('Message content updated successfully.');
        } catch (error) {
            console.log('editMessageContent: ', error.message);
        }
    }

    async deleteMessage(chatId, messageId) {
        try {
            const db = admin.firestore();
            const chatRef = db.collection('chats').doc(chatId);
            const messageRef = chatRef.collection('messages').doc(messageId);

            await db.runTransaction(async (transaction) => {
                const chatDoc = await transaction.get(chatRef);
                if (chatDoc.exists && chatDoc.data()['messageId'] === messageId) {
                    transaction.update(chatRef, { lastMessage: `deleted a message` });
                }

                // Cập nhật thông tin của message
                transaction.update(messageRef, {
                    isEdited: false,
                    isDeleted: true,
                    text: 'This message is deleted',
                    type: 'text'
                });
            });
            console.log('Delete message successfully.');
        } catch (error) {
            console.log('deleteMessage: ', error.message);
        }
    }

    async getUserDoc(userId) {
        const db = admin.firestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        return userDoc;
    }

    async updateDoc(docId, content, changeBy) {
        try {
            const db = admin.firestore();
            const docRef = db.collection('docs').doc(docId);
            const today = admin.firestore.FieldValue.serverTimestamp();

            await docRef.update({
                content: content,
                lastChange: today,
                changeBy: changeBy,
            });
        }
        catch (e) {
            console.log('updateDoc' + e.message);
        }
    }
}

module.exports = FirebaseService;