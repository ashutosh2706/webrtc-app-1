import './style.css'
import { firebaseApp } from './config/firebaseConfig'
import { getFirestore, doc, collection, addDoc, setDoc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore'
import { useState } from 'react';


/**
 * channel unable to send blob types.
 * if i send it as array of data chunks, then packet loss (file corrupts) by doing recombination of chunks on receiver side
 * so this idea hasn't been taken any further
 */

function App() {

  const [callId, setCallId] = useState<string>('');
  const [file, setFile] = useState<any>();

  const firestore = getFirestore(firebaseApp);

  const servers = {
    iceServers: [
      {
        urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302',
          'stun:global.stun.twilio.com:3478',
          'stun:stun.stunprotocol.org:3478',
          'stun:stun.services.mozilla.com:3478'
        ],
      },
    ],
    iceCandidatePoolSize: 10,
  };

  const peerConnection = new RTCPeerConnection(servers);


  const dataChannel = peerConnection.createDataChannel("channel", {
    ordered: true,
    protocol: 'raw'
  });

  dataChannel.binaryType = 'arraybuffer';
  dataChannel.addEventListener('open', event => {
    console.log("Channel open 👌");
  });



  peerConnection.ondatachannel = (event) => {
    const dataChannel = event.channel;
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onmessage = (event) => {
      // const arrayBuffer = event.data;
      // const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
      // const url = URL.createObjectURL(blob);

      // // Create a link to download the image
      // const link = document.createElement('a');
      // link.href = url;
      // link.download = 'received-image.jpeg'; // Set the default download filename
      // link.textContent = 'Download Image';

      // // Append the link to the document and trigger a click to start the download
      // document.body.appendChild(link);
      // link.click();

      // // Clean up: remove the link and revoke the object URL
      // document.body.removeChild(link);
      // URL.revokeObjectURL(url);

      // console.log("File received and download initiated");
      console.log('Message received: ' + event.data);
    };

    dataChannel.onopen = () => {
      console.log("Data channel is open and ready to be used.");
    };

    dataChannel.onerror = (error) => {
      console.error("Data channel error:", error);
    };

    dataChannel.onclose = () => {
      console.log("Data channel is closed.");
    };
  };


  const sendFile = () => {
    if (dataChannel.readyState === "open") {
      const reader = new FileReader();
      reader.onload = (event) => {
        const blob = new Blob([event.target.result], { type: file.type });
        dataChannel.send(blob);
        console.log("File sent");
      };
      reader.readAsArrayBuffer(file); // Read the file as an ArrayBuffer
      // dataChannel.send('Hi There!!!');
    } else {
      console.error("Data channel is not open!! Current State: " + dataChannel.readyState);
    }
  }


  const createCall = async () => {

    // create an offer and add to firestore
    const callDoc = doc(collection(firestore, "calls"));
    const offerCandidates = collection(callDoc, "offerCandidates");
    const answerCandidates = collection(callDoc, "answerCandidates");

    const callDocId = callDoc.id;


    peerConnection.onicecandidate = (event) => {
      event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
      console.log('calling event candidate: ' + event.candidate);
    };

    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    };

    await setDoc(callDoc, { offer });

    // Listen for remote answer
    onSnapshot(callDoc, async (snapshot) => {
      const data = snapshot.data();
      if (data && data.answer) {
        // Check if the remote description is not set
        if (!peerConnection.currentRemoteDescription) {
          try {
            const answerDescription = new RTCSessionDescription(data.answer);
            await peerConnection.setRemoteDescription(answerDescription);
            console.log('Remote description set successfully. for caller');
          } catch (error) {
            console.error('Error setting remote description: ', error);
          }
        }
      }
    });


    onSnapshot(answerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const candidateData = change.doc.data();
          const candidate = new RTCIceCandidate(candidateData);
          peerConnection.addIceCandidate(candidate)
            .then(() => {
              console.log('ICE candidate added successfully.');
            })
            .catch((error) => {
              console.error('Error adding ICE candidate: ', error);
            });
        }
      });
    });

    window.alert(`Call success ${callDocId}`);
    console.log(callDocId);
    navigator.clipboard.writeText(callDocId).then(() => {
      console.log('Call Id copied to clipboard.');
    })
  }

  /**
   * @description
   * answer call with unique id
   */
  const answerCall = async () => {

    const callDocRef = doc(firestore, 'calls', callId);
    const answerCandidatesRef = collection(callDocRef, 'answerCandidates');
    const offerCandidatesRef = collection(callDocRef, 'offerCandidates');

    peerConnection.onicecandidate = (event) => {
      event.candidate && addDoc(answerCandidatesRef, event.candidate.toJSON());
      console.log('answer event candidate: ' + event.candidate);
    };

    const callData = (await getDoc(callDocRef)).data();

    if (callData && callData.offer) {
      const offerDescription = callData.offer;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));
      console.log('Remote description set for answer side');
    } else {
      window.alert('Error: 114');
    }

    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };

    await updateDoc(callDocRef, { answer });

    onSnapshot(offerCandidatesRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          let data = change.doc.data();
          peerConnection.addIceCandidate(new RTCIceCandidate(data));
          console.log('Adding ice candidate for receiver');
        }
      })
    })

    window.alert('Answered to call: ' + callId);


  }

  return (
    <>
      <h2>Create a new WebRTC offer</h2>
      <button id="callButton" onClick={createCall}>Create Offer</button>

      <h2>Join</h2>
      <p>Answer the offer from a different browser window or device</p>

      <input id="callInput" value={callId} onChange={(e) => {
        setCallId(e.target.value);
      }} />
      <button id="answerButton" onClick={answerCall}>Answer</button>
      <div style={{ marginTop: "20px" }}>
        <input type='file' accept='image/jpeg' onChange={(event) => {
          if (event.target.files) {
            setFile(event.target.files[0]);
          }
        }}></input>
      </div>
      <div>
        <button onClick={sendFile} >Send File</button>
      </div>

    </>
  )
}

export default App
