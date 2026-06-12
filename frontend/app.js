const result = document.querySelector("#apiResult");
const button = document.querySelector("#loadMessage");

async function loadMessage() {
  result.textContent = "Dang goi API...";

  try {
    const response = await fetch("/api/message");
    const data = await response.json();
    result.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    result.textContent = `Khong goi duoc backend: ${error.message}`;
  }
}

button.addEventListener("click", loadMessage);
loadMessage();
