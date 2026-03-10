registerGame("connect4", "🔵 Connect 4", "Click a column to drop", "Get 4 in a row to win!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a4e");
    this.cols=7;this.rows=6;this.cellSize=60;
    this.grid=Array.from({length:this.rows},()=>Array(this.cols).fill(0));
    this.turn=1;this.over=false;
    const ox=(W-this.cols*this.cellSize)/2,oy=(H-this.rows*this.cellSize)/2;this.ox=ox;this.oy=oy;
    // Draw board
    this.add.rectangle(ox+this.cols*this.cellSize/2,oy+this.rows*this.cellSize/2,this.cols*this.cellSize+10,this.rows*this.cellSize+10,0x1a1a88).setStrokeStyle(2,0x3333aa);
    this.circles=[];
    for(let r=0;r<this.rows;r++){this.circles[r]=[];for(let c=0;c<this.cols;c++){
      this.circles[r][c]=this.add.circle(ox+c*this.cellSize+30,oy+r*this.cellSize+30,24,0x0a0a3e);
    }}
    this.turnTxt=this.add.text(W/2,oy-30,"P1's turn (click column)",{fontSize:"18px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
    // Click columns
    for(let c=0;c<this.cols;c++){
      const zone=this.add.rectangle(ox+c*this.cellSize+30,oy+this.rows*this.cellSize/2,this.cellSize,this.rows*this.cellSize,0x000000).setAlpha(0.01).setInteractive();
      zone.on("pointerdown",()=>this.drop(c));
    }
  }
  drop(col){
    if(this.over)return;
    let row=-1;for(let r=this.rows-1;r>=0;r--){if(this.grid[r][col]===0){row=r;break;}}
    if(row===-1)return;
    this.grid[row][col]=this.turn;
    this.circles[row][col].fillColor=this.turn===1?0xf7c948:0xe94560;
    if(this.checkWin(row,col)){this.over=true;this.turnTxt.setText("P"+(this.turn)+" WINS!").setColor(this.turn===1?"#f7c948":"#e94560").setFontSize(28);return;}
    if(this.grid.flat().every(v=>v!==0)){this.over=true;this.turnTxt.setText("DRAW!").setColor("#fff");return;}
    this.turn=this.turn===1?2:1;this.turnTxt.setText("P"+this.turn+"'s turn").setColor(this.turn===1?"#f7c948":"#e94560");
  }
  checkWin(r,c){const t=this.turn,g=this.grid;
    const dirs=[[0,1],[1,0],[1,1],[1,-1]];
    for(const[dr,dc]of dirs){let count=1;
      for(let i=1;i<4;i++){const nr=r+dr*i,nc=c+dc*i;if(nr>=0&&nr<this.rows&&nc>=0&&nc<this.cols&&g[nr][nc]===t)count++;else break;}
      for(let i=1;i<4;i++){const nr=r-dr*i,nc=c-dc*i;if(nr>=0&&nr<this.rows&&nc>=0&&nc<this.cols&&g[nr][nc]===t)count++;else break;}
      if(count>=4)return true;}
    return false;
  }
  update(){}
});
