 
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { 
            getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut 
        } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { 
            getFirestore, collection, addDoc, onSnapshot, doc, getDoc, setDoc, query, orderBy, serverTimestamp, setLogLevel 
        } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        // Set log level for debugging (optional, but helpful)
        setLogLevel('debug');

        // Global Firebase and App variables
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        let db;
        let auth;
        let currentUserId = null;
        let currentUsername = 'Guest';
        let isAuthReady = false;

        // Firestore paths
        const POSTS_COLLECTION_PATH = ['artifacts', appId, 'public', 'data', 'posts'];
        const USER_DOC_PATH = (uid) => ['artifacts', appId, 'users', uid, 'profile', 'data'];

        // --- DOM Elements ---
        const authControlsEl = document.getElementById('auth-controls');
        const userDisplayEl = document.getElementById('user-display');
        const loginLogoutBtn = document.getElementById('login-logout-btn');
        const newPostBtn = document.getElementById('new-post-btn');
        const postForm = document.getElementById('post-form');
        const postModal = document.getElementById('post-modal');
        const closePostModal = document.getElementById('close-post-modal');
        const postsContainer = document.getElementById('posts-container');
        const loadingMessage = document.getElementById('loading-message');
        const createPostSection = document.getElementById('create-post-section');
        const postErrorEl = document.getElementById('post-error');
        
        const messageModal = document.getElementById('message-modal');
        const messageTitle = document.getElementById('message-title');
        const messageContent = document.getElementById('message-content');
        const usernameInput = document.getElementById('username-input');
        const closeMessageModal = document.getElementById('close-message-modal');


        // --- Utility Functions ---

        /**
         * Shows the custom message/username modal.
         * @param {string} title - The title of the modal.
         * @param {string} content - The content text.
         * @param {boolean} showInput - Whether to show the username input field.
         * @param {function} onConfirm - The function to call on confirm/save.
         */
        const showMessageModal = (title, content, showInput, onConfirm) => {
            messageTitle.textContent = title;
            messageContent.textContent = content;
            usernameInput.value = ''; // Clear previous value
            
            if (showInput) {
                usernameInput.classList.remove('hidden');
                closeMessageModal.textContent = 'Save';
            } else {
                usernameInput.classList.add('hidden');
                closeMessageModal.textContent = 'Close';
            }

            closeMessageModal.onclick = () => {
                if (showInput && typeof onConfirm === 'function') {
                    onConfirm(usernameInput.value.trim());
                }
                messageModal.classList.add('hidden');
            };

            messageModal.classList.remove('hidden');
        };

        const checkUsername = async (user) => {
            const userDocRef = doc(db, ...USER_DOC_PATH(user.uid));
            try {
                const userDocSnap = await getDoc(userDocRef);
                
                if (userDocSnap.exists()) {
                    currentUsername = userDocSnap.data().username || `User_${user.uid.substring(0, 5)}`;
                    updateUI(true);
                } else {
                    // New user: Prompt for username
                    showMessageModal(
                        "Welcome to MscndConnect!", 
                        "Please choose a username. This will be visible on your posts.", 
                        true, 
                        async (username) => {
                            if (username && username.length > 2) {
                                currentUsername = username;
                                await setDoc(userDocRef, { 
                                    username: currentUsername, 
                                    uid: user.uid, 
                                    createdAt: serverTimestamp() 
                                }, { merge: true });
                                updateUI(true);
                            } else {
                                // If user cancels or enters invalid name, set a default
                                currentUsername = `User_${user.uid.substring(0, 5)}`;
                                updateUI(true);
                            }
                        }
                    );
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
                currentUsername = `User_${user.uid.substring(0, 5)}`;
                updateUI(true);
            }
        };

        // --- UI Updates ---
        const updateUI = (isLoggedIn) => {
            isAuthReady = true;
            loadingMessage.classList.add('hidden'); // Hide loading message once auth is ready

            if (isLoggedIn) {
                userDisplayEl.textContent = `Hello, ${currentUsername}!`;
                userDisplayEl.classList.remove('hidden');
                
                loginLogoutBtn.textContent = 'Logout';
                loginLogoutBtn.onclick = handleLogout;
                
                createPostSection.classList.remove('hidden');
            } else {
                userDisplayEl.textContent = 'Guest';
                userDisplayEl.classList.remove('hidden');
                
                loginLogoutBtn.textContent = 'Login / Sign Up';
                loginLogoutBtn.onclick = handleLogin;
                
                createPostSection.classList.add('hidden');
                showMessageModal("Access Denied", "You must be signed in to create posts. Please click 'Login / Sign Up'.", false, () => {});
            }
            fetchPosts();
        };

        // --- Auth Handlers ---
        const handleLogin = async () => {
            // Since we are using an anonymous/custom token system, clicking "Login"
            // just re-authenticates or signs in anonymously if the token is missing.
            await signInWithCustomToken(auth, initialAuthToken)
                .catch(async (e) => {
                    console.warn("Custom token failed or was unavailable, signing in anonymously.", e);
                    await signInAnonymously(auth);
                });
        };

        const handleLogout = async () => {
            try {
                await signOut(auth);
                currentUserId = null;
                currentUsername = 'Guest';
                updateUI(false);
            } catch (error) {
                console.error("Logout failed:", error);
                showMessageModal("Error", "Could not log out. Please try again.", false, () => {});
            }
        };


        // --- Post Handlers (CRUD) ---

        const handlePostSubmit = async (event) => {
            event.preventDefault();
            
            if (!currentUserId) {
                postErrorEl.textContent = "You must be signed in to post.";
                postErrorEl.classList.remove('hidden');
                return;
            }

            const title = document.getElementById('post-title').value.trim();
            const content = document.getElementById('post-content').value.trim();

            if (!title || !content) {
                postErrorEl.textContent = "Title and content cannot be empty.";
                postErrorEl.classList.remove('hidden');
                return;
            }

            // Hide previous errors and button
            postErrorEl.classList.add('hidden');
            const submitBtn = document.getElementById('submit-post-btn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Posting...';

            try {
                const postsColRef = collection(db, ...POSTS_COLLECTION_PATH);
                await addDoc(postsColRef, {
                    title: title,
                    content: content,
                    authorId: currentUserId,
                    authorUsername: currentUsername,
                    timestamp: serverTimestamp(),
                });
                
                // Clear form and close modal on success
                postForm.reset();
                postModal.classList.add('hidden');
            } catch (e) {
                console.error("Error adding document: ", e);
                postErrorEl.textContent = "Failed to create post. Check console for details.";
                postErrorEl.classList.remove('hidden');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Post Idea';
            }
        };

        const renderPost = (data, id) => {
            const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString() : 'Just now';
            
            return `
                <div id="post-${id}" class="post-card bg-white p-6 rounded-xl border border-gray-200">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="text-xl font-semibold text-gray-900">${data.title}</h3>
                        <span class="text-xs text-indigo-500 font-medium bg-indigo-50 px-2 py-1 rounded-full">${data.authorUsername}</span>
                    </div>
                    <p class="text-gray-600 leading-relaxed mb-4 whitespace-pre-wrap">${data.content}</p>
                    <div class="flex justify-between items-center text-xs text-gray-500">
                        <span>Posted on ${date}</span>
                        <!-- You can add a 'Like' or 'Connect' button here -->
                        <button class="text-indigo-600 hover:text-indigo-800 font-medium">
                            Connect <span aria-hidden="true">&rarr;</span>
                        </button>
                    </div>
                </div>
            `;
        };
        
        const fetchPosts = () => {
            postsContainer.innerHTML = ''; // Clear existing posts
            loadingMessage.classList.remove('hidden');

            const postsColRef = collection(db, ...POSTS_COLLECTION_PATH);
            // Query to order by timestamp descending (newest first)
            const q = query(postsColRef, orderBy('timestamp', 'desc'));

            // Set up real-time listener
            const unsubscribe = onSnapshot(q, (snapshot) => {
                loadingMessage.classList.add('hidden');
                if (snapshot.empty) {
                    postsContainer.innerHTML = '<p class="text-center text-gray-500 mt-8">No posts yet. Be the first to share your idea!</p>';
                    return;
                }

                postsContainer.innerHTML = '';
                snapshot.forEach((doc) => {
                    const postData = doc.data();
                    postsContainer.innerHTML += renderPost(postData, doc.id);
                });
            }, (error) => {
                console.error("Error listening to posts: ", error);
                loadingMessage.textContent = 'Failed to load posts.';
            });

            // Note: In a larger app, you'd manage this unsubscribe for cleanup.
            // For a single-page HTML app, it runs for the life of the page.
        };


        // --- Initialization ---
        window.onload = async () => {
            try {
                const app = initializeApp(firebaseConfig);
                db = getFirestore(app);
                auth = getAuth(app);

                // 1. Attempt to sign in with the custom token or anonymously
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken).catch(async (e) => {
                        console.warn("Custom token failed, falling back to anonymous sign-in.", e);
                        await signInAnonymously(auth);
                    });
                } else {
                    await signInAnonymously(auth);
                }

                // 2. Set up the Auth State Listener
                onAuthStateChanged(auth, (user) => {
                    if (user) {
                        currentUserId = user.uid;
                        // Check if the user has a stored username, otherwise prompt them
                        checkUsername(user);
                    } else {
                        currentUserId = null;
                        currentUsername = 'Guest';
                        updateUI(false);
                    }
                });

                // 3. Setup event listeners
                newPostBtn.onclick = () => {
                    postModal.classList.remove('hidden');
                    postErrorEl.classList.add('hidden');
                };
                closePostModal.onclick = () => postModal.classList.add('hidden');
                postForm.onsubmit = handlePostSubmit;


            } catch (error) {
                console.error("Firebase Initialization Error:", error);
                loginLogoutBtn.textContent = 'Error';
                loginLogoutBtn.disabled = true;
                loadingMessage.textContent = 'Application failed to initialize database/auth.';
            }
        };

 