// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Simple utitlity for for Event subscription
 */
import EventBus from "./eventbus"

class ChatInterface {

  clientConfig = {
    contactFlowId: "",
    instanceId: "",
    region: "",
    stage: "prod",
    contactAttributes: {},
    featurePermissions: {}
  }

  initiateChat(input, success, failure) {
    let chatInput  = Object.assign({}, this.clientConfig, input);
    let chatSessionData = null;

    const storageKey = input.chatPersistence;
    const storage = window[storageKey];

    if (storage) {
      chatSessionData = JSON.parse(storage.getItem("chatSessionData"));
    }

    if (chatSessionData) {
       // Trigger the 'rehydrateChat' event to re-establish a persisted session.
      EventBus.trigger("rehydrateChat", {
        ...chatInput,
        ...chatSessionData,
      }, success, failure);
    } else {
     // Trigger the 'initChat' event to start a brand new chat session.
     EventBus.trigger("initChat", chatInput, success, failure);
    }
  }
}


window.connect = window.connect || {};
window.connect.ChatInterface = window.connect.ChatInterface || new ChatInterface();


window.addEventListener("message", function(data){
  if(data.initChat){
    window.connect.ChatInterface.initiateChat(data);
  }
})

